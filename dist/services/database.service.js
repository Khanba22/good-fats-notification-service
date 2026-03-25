"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseService = exports.DatabaseService = void 0;
const client_1 = require("../generated/prisma/client");
class DatabaseService {
    prisma;
    constructor() {
        this.prisma = new client_1.PrismaClient();
    }
    async getPendingJobs() {
        const now = new Date();
        return this.prisma.scheduledJob.findMany({
            where: {
                completed: false,
                scheduledFor: {
                    lte: now
                }
            }
        });
    }
    async completeJob(jobId) {
        return this.prisma.scheduledJob.update({
            where: { jobId },
            data: {
                completed: true,
                completedAt: new Date()
            }
        });
    }
    async createJob(jobId, phone, topic, payload, scheduledFor) {
        return this.prisma.scheduledJob.upsert({
            where: { jobId },
            update: {
                phone,
                topic,
                payload: payload || {},
                scheduledFor,
                completed: false,
                completedAt: null
            },
            create: {
                jobId,
                phone,
                topic,
                payload: payload || {},
                scheduledFor
            }
        });
    }
    async cancelJobsForOrder(orderId) {
        const prefix = `${orderId}_`;
        const jobs = await this.prisma.scheduledJob.findMany({
            where: {
                jobId: {
                    startsWith: prefix
                },
                completed: false
            }
        });
        for (const job of jobs) {
            await this.prisma.scheduledJob.delete({
                where: { id: job.id }
            });
        }
        return jobs.length;
    }
    async getScheduledJobs() {
        const jobs = await this.prisma.scheduledJob.findMany({
            where: {
                completed: false
            },
            orderBy: {
                scheduledFor: 'asc'
            }
        });
        return jobs.map((j) => ({
            jobId: j.jobId,
            phone: j.phone,
            topic: j.topic,
            scheduledFor: j.scheduledFor.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
            scheduledForISO: j.scheduledFor.toISOString(),
        }));
    }
    async getActiveJobCount() {
        return this.prisma.scheduledJob.count({
            where: {
                completed: false
            }
        });
    }
}
exports.DatabaseService = DatabaseService;
exports.databaseService = new DatabaseService();
