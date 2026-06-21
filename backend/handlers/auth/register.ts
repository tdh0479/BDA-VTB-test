import { VercelRequest, VercelResponse } from '@vercel/node';
import connectDB from '../../../lib/mongodb';
import { User, AuditLog } from '../../../lib/models';
import { hashPassword, generateToken } from '../../../lib/auth';
import { ORGANIZATIONS } from '../../../lib/models/User';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        await connectDB();

        const { name, password, confirmPassword, organization } = req.body;

        if (!name || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Mật khẩu xác nhận không khớp' });
        }

        if (organization && !ORGANIZATIONS.includes(organization)) {
            return res.status(400).json({ error: 'Tổ chức không hợp lệ' });
        }

        const org = organization || ORGANIZATIONS[0];

        const existingUser = await (User as any).findOne({ name });
        if (existingUser) {
            return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
        }

        const hashedPassword = await hashPassword(password);
        const user = await (User as any).create({
            name,
            password: hashedPassword,
            role: 'User2',
            status: 'Pending',
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
            permissions: ['dashboard', 'projects', 'transactions'],
            organization: org
        });

        await (AuditLog as any).create({
            actor: user.name,
            role: user.role,
            action: 'Đăng ký tài khoản',
            target: 'Hệ thống',
            details: `Đăng ký tài khoản mới từ ${org}`
        });

        const userObj = user.toObject ? user.toObject({ virtuals: true }) : user;

        return res.status(201).json({
            success: true,
            data: {
                ...userObj,
                id: (userObj.id || userObj._id || user._id).toString()
            },
            message: 'Đăng ký thành công! Tài khoản của bạn đang chờ Admin phê duyệt.'
        });

    } catch (error: any) {
        console.error('Register error:', error);
        return res.status(500).json({ error: 'Lỗi server: ' + error.message });
    }
}
