import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../../lib/mongodb';
import { Project, AuditLog } from '../../../lib/models';
import { authMiddleware } from '../../../lib/auth';
import { synologyUploadAndShare } from '../../../lib/synology';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';

const buildUploadPath = (projectId: string, filename: string) => {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const publicDir = path.resolve(process.cwd(), 'public', 'uploads', 'projects', projectId);
    let uploadDir = publicDir;
    let usedPublic = true;

    if (process.env.VERCEL || process.env.VERCEL_ENV) {
        usedPublic = false;
        uploadDir = path.join(os.tmpdir(), 'vtb-uploads', 'projects', projectId);
    }

    try {
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        // Test write access to catch read-only filesystems (even if directory exists)
        const testFile = path.join(uploadDir, '.test_write');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
    } catch (err) {
        // If we cannot create inside the project (serverless / read-only), fallback to OS temp directory
        usedPublic = false;
        uploadDir = path.join(os.tmpdir(), 'vtb-uploads', 'projects', projectId);
        try {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
        } catch (err2) {
            // As a last resort, throw so caller can handle
            throw err2;
        }
    }

    return {
        uploadDir,
        safeName,
        uploadPath: path.join(uploadDir, safeName),
        // publicUrl only valid when we wrote into the `public` folder; otherwise caller should expose via API
        publicUrl: usedPublic ? `/uploads/projects/${projectId}/${safeName}` : null
    };
};

const getAttachmentBuffer = (att: any) => {
    if (att.filePath && fs.existsSync(att.filePath)) {
        return fs.readFileSync(att.filePath);
    }

    if (att.url && typeof att.url === 'string') {
        if (att.url.startsWith('/uploads/')) {
            const localPath = path.resolve(process.cwd(), 'public', att.url.replace(/^\//, ''));
            if (fs.existsSync(localPath)) {
                return fs.readFileSync(localPath);
            }
        }

        if (att.url.startsWith('data:')) {
            const base64Segment = att.url.includes(',') ? att.url.split(',')[1] : att.url;
            return Buffer.from(base64Segment, 'base64');
        }
    }

    return null;
};



export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const payload = await authMiddleware(req, res);
        if (!payload) return;

        await connectDB();

        let id = req.query.id || (req as any).params?.id;
        if (Array.isArray(id)) id = id[0];

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'Project ID required' });
        }

        let attachmentId = req.query.attachmentId || (req as any).params?.attachmentId;
        if (!attachmentId && typeof req.url === 'string') {
            const urlPath = req.url.split('?')[0];
            // Match /attachments/:id, /attachments/:id/drive or /attachments/:id/file
            const urlMatch = urlPath.match(/\/attachments\/([^\/]+)(?:\/(drive|file))?\/?$/);
            if (urlMatch) {
                attachmentId = urlMatch[1];
            }
        }

        const action = req.query.action || (req as any).params?.action || (typeof req.url === 'string' && /\/synology\/?$/.test(req.url.split('?')[0]) ? 'synology' : undefined);
        console.log(`[PROJECTS ATTACHMENTS] method=${req.method} id=${id} attachmentId=${attachmentId} action=${action} query=${JSON.stringify(req.query)} params=${JSON.stringify((req as any).params)} url=${req.url}`);

        // GET /api/projects/:id/attachments/:attachmentId -> serve attachment file
        if (req.method === 'GET' && attachmentId) {
            const project = await (Project as any).findById(id);
            if (!project) return res.status(404).json({ error: 'Project not found' });

            const att = (project.attachments || []).find((a: any) => String(a.id) === String(attachmentId));
            if (!att) return res.status(404).json({ error: 'Attachment not found' });

            // Serve from filePath if available
            if (att.filePath && fs.existsSync(att.filePath)) {
                try {
                    const buffer = fs.readFileSync(att.filePath);
                    res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
                    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`);
                    return res.status(200).send(buffer as any);
                } catch (err) {
                    console.warn('Error reading attachment file:', err);
                    return res.status(500).json({ error: 'Could not read attachment file' });
                }
            }

            // If url points to /uploads/ and file exists in public, serve it
            if (att.url && typeof att.url === 'string' && att.url.startsWith('/uploads/')) {
                const localPath = path.resolve(process.cwd(), 'public', att.url.replace(/^\//, ''));
                if (fs.existsSync(localPath)) {
                    try {
                        const buffer = fs.readFileSync(localPath);
                        res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
                        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`);
                        return res.status(200).send(buffer as any);
                    } catch (err) {
                        console.warn('Error reading public attachment file:', err);
                        return res.status(500).json({ error: 'Could not read attachment file' });
                    }
                }
            }

            return res.status(404).json({ error: 'Attachment not found on server' });
        }

        // POST /api/projects/:id/attachments -> add attachment
        if (req.method === 'POST' && !attachmentId) {
            const attachmentPayload = req.body;
            if (!attachmentPayload || !attachmentPayload.id || !attachmentPayload.name) {
                return res.status(400).json({ error: 'Attachment payload required' });
            }

            const project = await (Project as any).findById(id);
            if (!project) return res.status(404).json({ error: 'Project not found' });

            const { uploadPath, publicUrl, safeName } = buildUploadPath(id, attachmentPayload.name);
            if (attachmentPayload.url && typeof attachmentPayload.url === 'string' && attachmentPayload.url.startsWith('data:')) {
                const base64Segment = attachmentPayload.url.includes(',') ? attachmentPayload.url.split(',')[1] : attachmentPayload.url;
                fs.writeFileSync(uploadPath, Buffer.from(base64Segment, 'base64'));
            } else if (attachmentPayload.filePath && typeof attachmentPayload.filePath === 'string' && fs.existsSync(attachmentPayload.filePath)) {
                const buffer = fs.readFileSync(attachmentPayload.filePath);
                fs.writeFileSync(uploadPath, buffer);
            } else {
                return res.status(400).json({ error: 'Attachment file data required' });
            }

            // Upload to Synology File Station
            let driveLink: string | null = null;
            let wroteToPublic = !!publicUrl;
            try {
                const bufferToUpload = fs.readFileSync(uploadPath);

                // Thay vì Google Drive, chúng ta đẩy lên Synology
                const synologyShareLink = await synologyUploadAndShare(bufferToUpload, safeName);

                if (synologyShareLink) {
                    driveLink = synologyShareLink;
                    // Xóa file local nếu upload Synology thành công
                    try {
                        if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
                        wroteToPublic = false;
                    } catch (rmErr) {
                        console.warn('Could not remove local upload after Synology upload:', rmErr);
                    }
                }
            } catch (err) {
                console.warn('Auto-upload to Synology failed (non-fatal):', err);
            }

            const finalUrl = driveLink || publicUrl || `/api/projects/${id}/attachments/${attachmentPayload.id}/file`;

            const attachment = {
                id: attachmentPayload.id,
                name: safeName,
                mimeType: attachmentPayload.mimeType || 'application/octet-stream',
                url: finalUrl,
                filePath: fs.existsSync(uploadPath) ? uploadPath : null,
                driverLink: driveLink,
                uploadedAt: attachmentPayload.uploadedAt ? new Date(attachmentPayload.uploadedAt) : new Date()
            };

            project.attachments = project.attachments || [];
            project.attachments.push(attachment);
            await project.save();

            await (AuditLog as any).create({
                actor: payload.name,
                role: payload.role,
                action: 'Đính kèm tệp',
                target: `Dự án ${(project as any).code || id}`,
                details: `Đã đính kèm tệp ${attachment.name}`
            });

            const responseBody: any = { success: true, data: attachment };

            return res.status(200).json(responseBody);
        }

        // POST /api/projects/:id/attachments/:attachmentId/synology -> upload to Synology
        if (req.method === 'POST' && attachmentId && action === 'synology') {
            const project = await (Project as any).findById(id);
            if (!project) return res.status(404).json({ error: 'Project not found' });

            const att = (project.attachments || []).find((a: any) => String(a.id) === String(attachmentId));
            if (!att) return res.status(404).json({ error: 'Attachment not found' });

            const buffer = getAttachmentBuffer(att);
            if (!buffer) {
                return res.status(400).json({ error: 'Attachment file not found on server' });
            }

            let driveLink: string | null = null;
            try {
                const synologyShareLink = await synologyUploadAndShare(buffer, att.name);
                if (!synologyShareLink) {
                    return res.status(500).json({ error: 'Synology upload failed.' });
                }
                driveLink = synologyShareLink;
            } catch (err: any) {
                return res.status(500).json({
                    error: 'Synology upload failed.',
                    details: err?.message || String(err)
                });
            }

            const savedAttachment = (project.attachments || []).find((a: any) => String(a.id) === String(attachmentId));
            if (savedAttachment) {
                savedAttachment.driverLink = driveLink;
            }
            await project.save();

            await (AuditLog as any).create({
                actor: payload.name,
                role: payload.role,
                action: 'Upload lên Synology NAS',
                target: `Dự án ${(project as any).code || id}`,
                details: `Đã upload tệp ${att.name} lên NAS: ${driveLink}`
            });

            return res.status(200).json({ success: true, data: { id: attachmentId, driveLink } });
        }

        // DELETE /api/projects/:id/attachments/:attachmentId -> remove attachment
        if (req.method === 'DELETE' && attachmentId) {
            const project = await (Project as any).findById(id);
            if (!project) return res.status(404).json({ error: 'Project not found' });

            const isLockManager = ['SuperAdmin', 'Admin', 'PMB'].includes(payload.role);
            if (project.locked && !isLockManager) {
                return res.status(403).json({ error: 'Dự án đang Khóa. Chỉ SuperAdmin, Admin hoặc PMB mới được xóa tệp.' });
            }

            if (!project.attachments || project.attachments.length === 0) {
                return res.status(404).json({ error: 'Attachment not found' });
            }

            const attachmentIndex = project.attachments.findIndex((a: any) => String(a.id) === String(attachmentId));
            if (attachmentIndex === -1) return res.status(404).json({ error: 'Attachment not found' });

            const removedAttachment = project.attachments[attachmentIndex];
            if (removedAttachment.filePath && fs.existsSync(removedAttachment.filePath)) {
                try {
                    fs.unlinkSync(removedAttachment.filePath);
                } catch (err) {
                    console.warn('Could not delete attachment file:', err);
                }
            }

            project.attachments.splice(attachmentIndex, 1);
            await project.save();

            await (AuditLog as any).create({
                actor: payload.name,
                role: payload.role,
                action: 'Xóa tệp đính kèm',
                target: `Dự án ${(project as any).code || id}`,
                details: `Đã xóa tệp ${removedAttachment.name}`
            });

            return res.status(200).json({ success: true, data: { id: attachmentId } });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err: any) {
        console.error('Attachments handler error:', err);
        return res.status(500).json({ error: 'Server error: ' + (err.message || String(err)) });
    }
}
