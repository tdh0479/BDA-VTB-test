import fs from 'fs';

interface SynologyConfig {
    url: string;
    user: string;
    pass: string;
    destFolder: string;
}

export class SynologyClient {
    private url: string;
    private user: string;
    private pass: string;
    private destFolder: string;
    private sid: string | null = null;

    constructor() {
        this.url = (process.env.SYNOLOGY_URL || '').replace(/\/$/, '');
        this.user = process.env.SYNOLOGY_USERNAME || '';
        this.pass = process.env.SYNOLOGY_PASSWORD || '';
        this.destFolder = process.env.SYNOLOGY_DEST_FOLDER_PATH || '';
    }

    private isConfigured(): boolean {
        return Boolean(this.url && this.user && this.pass && this.destFolder);
    }

    private async login(): Promise<boolean> {
        if (!this.isConfigured()) {
            console.error('[Synology] Missing configuration in .env.local');
            return false;
        }

        try {
            const loginUrl = `${this.url}/webapi/auth.cgi?api=SYNO.API.Auth&version=3&method=login&account=${encodeURIComponent(this.user)}&passwd=${encodeURIComponent(this.pass)}&session=FileStation&format=sid`;
            
            const response = await fetch(loginUrl);
            const data = await response.json();

            if (data.success && data.data && data.data.sid) {
                this.sid = data.data.sid;
                return true;
            } else {
                console.error('[Synology] Login failed:', data);
                return false;
            }
        } catch (error) {
            console.error('[Synology] Login request error:', error);
            return false;
        }
    }

    public async uploadAndShare(buffer: Buffer, filename: string): Promise<string | null> {
        if (!this.sid) {
            const loggedIn = await this.login();
            if (!loggedIn) return null;
        }

        try {
            // 1. Upload File
            const uploadFormData = new FormData();
            uploadFormData.append('api', 'SYNO.FileStation.Upload');
            uploadFormData.append('version', '2');
            uploadFormData.append('method', 'upload');
            uploadFormData.append('path', this.destFolder);
            uploadFormData.append('create_parents', 'true');
            uploadFormData.append('overwrite', 'true');
            uploadFormData.append('_sid', this.sid!);
            
            // Convert Node Buffer to Blob
            const blob = new Blob([new Uint8Array(buffer)]);
            uploadFormData.append('file', blob, filename);

            const uploadResponse = await fetch(`${this.url}/webapi/entry.cgi?_sid=${this.sid!}`, {
                method: 'POST',
                body: uploadFormData
            });

            const uploadData = await uploadResponse.json();
            if (!uploadData.success) {
                console.error('[Synology] Upload failed:', uploadData);
                return null;
            }

            // 2. Create Share Link
            const filePath = `${this.destFolder}/${filename}`.replace(/\/\//g, '/');
            const shareUrl = `${this.url}/webapi/entry.cgi?api=SYNO.FileStation.Sharing&version=3&method=create&path=${encodeURIComponent(filePath)}&_sid=${this.sid!}`;
            
            const shareResponse = await fetch(shareUrl, { method: 'GET' });
            const shareData = await shareResponse.json();

            if (shareData.success && shareData.data && shareData.data.links && shareData.data.links.length > 0) {
                return shareData.data.links[0].url;
            } else {
                console.error('[Synology] Share link creation failed:', shareData);
                return null;
            }

        } catch (error) {
            console.error('[Synology] Upload/Share error:', error);
            return null;
        }
    }
}

export const synologyUploadAndShare = async (buffer: Buffer, filename: string): Promise<string | null> => {
    const client = new SynologyClient();
    return await client.uploadAndShare(buffer, filename);
};
