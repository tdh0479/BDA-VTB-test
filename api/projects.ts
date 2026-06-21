import { VercelRequest, VercelResponse } from '@vercel/node';
import projectsIndex from '../backend/handlers/projects/index';
import projectsImport from '../backend/handlers/projects/import';
import projectsId from '../backend/handlers/projects/_id';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '15mb',
        },
    },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url } = req;
    const path = url?.split('?')[0] || '';
    console.log(`[API PROJECTS] method=${req.method} url=${url} path=${path}`);

    if (path === '/api/projects' || path === '/api/projects/') return await projectsIndex(req, res);
    if (path.endsWith('/import')) return await projectsImport(req, res);

    // Single Project (ID)
    const parts = path.split('/');
    // /api/projects/:id
    if (parts.length === 4 && parts[2] === 'projects') {
        req.query.id = parts[3];
        return await projectsId(req, res);
    }

    // /api/projects/:id/attachments and /api/projects/:id/attachments/:attachmentId/synology
    const attachmentsRegex = /^\/api\/projects\/([^\/]+)\/attachments\/?$/;
    const deleteAttachmentRegex = /^\/api\/projects\/([^\/]+)\/attachments\/([^\/]+)\/?$/;
    const synologyAttachmentsRegex = /^\/api\/projects\/([^\/]+)\/attachments\/([^\/]+)\/synology\/?$/;

    const attachmentsMatch = path.match(attachmentsRegex);
    if (attachmentsMatch) {
        const attachmentsHandler = require('../backend/handlers/projects/attachments').default;
        req.query.id = attachmentsMatch[1];
        return await attachmentsHandler(req, res);
    }

    const deleteAttachmentMatch = path.match(deleteAttachmentRegex);
    if (deleteAttachmentMatch) {
        const attachmentsHandler = require('../backend/handlers/projects/attachments').default;
        req.query.id = deleteAttachmentMatch[1];
        req.query.attachmentId = deleteAttachmentMatch[2];
        return await attachmentsHandler(req, res);
    }

    const synologyAttachmentsMatch = path.match(synologyAttachmentsRegex);
    if (synologyAttachmentsMatch) {
        const attachmentsHandler = require('../backend/handlers/projects/attachments').default;
        req.query.id = synologyAttachmentsMatch[1];
        req.query.attachmentId = synologyAttachmentsMatch[2];
        req.query.action = 'synology';
        return await attachmentsHandler(req, res);
    }

    return res.status(404).json({ error: 'Project route not found' });
}
