import mongoose, { Schema, Document, Types } from 'mongoose';

export const ORGANIZATIONS = ['Đông Anh', 'Phúc Thịnh', 'Thiên Lộc', 'Thư Lâm', 'Vĩnh Thanh'] as const;
export type OrganizationType = typeof ORGANIZATIONS[number];

export interface Attachment {
    id: string;
    name: string;
    mimeType?: string;
    url?: string;
    filePath?: string;
    driverLink?: string | null;
    uploadedAt?: Date;
}

export interface IProject extends Document {
    code: string;
    name: string;
    location: string;
    totalBudget: number;
    startDate: Date;
    uploadDate: Date;
    interestStartDate?: Date;
    locked?: boolean;
    status: 'Active' | 'Completed' | 'Planning';
    organization: OrganizationType;
    uploadedBy?: Types.ObjectId;
    attachments?: Attachment[];
    updatedAt: Date;
}

const projectSchemaDefinition: any = {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    location: { type: String, default: '' },
    totalBudget: { type: Number, required: true, default: 0 },
    startDate: { type: Date, default: Date.now },
    uploadDate: { type: Date, default: Date.now },
    interestStartDate: { type: Date },
    locked: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['Active', 'Completed', 'Planning'],
        default: 'Active'
    },
    organization: {
        type: String,
        enum: ORGANIZATIONS,
        required: true
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    attachments: {
        type: [
            {
                id: { type: String, required: true },
                name: { type: String, required: true },
                mimeType: { type: String },
                url: { type: String },
                filePath: { type: String },
                driverLink: { type: String, default: null },
                uploadedAt: { type: Date, default: Date.now }
            }
        ],
        default: []
    }
};

const ProjectSchema = new Schema(projectSchemaDefinition, { timestamps: true });

ProjectSchema.index({ organization: 1 });
ProjectSchema.index({ updatedAt: -1 });

// Ensure virtual fields (like id) are serialized and _id is removed
ProjectSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc: any, ret: any) {
        if (ret && ret._id) {
            ret.id = ret._id.toString();
            delete ret._id;
        }
        return ret;
    }
});

ProjectSchema.set('toObject', {
    virtuals: true,
    versionKey: false,
    transform: function (doc: any, ret: any) {
        if (ret && ret._id) {
            ret.id = ret._id.toString();
            delete ret._id;
        }
        return ret;
    }
});

const Project = mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema);
export default Project as mongoose.Model<IProject>;
