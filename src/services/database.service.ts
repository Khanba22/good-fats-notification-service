import { PrismaClient } from '../generated/prisma/client';

export class DatabaseService {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = new PrismaClient();
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

    async completeJob(jobId: string) {
        return this.prisma.scheduledJob.update({
            where: { jobId },
            data: {
                completed: true,
                completedAt: new Date()
            }
        });
    }

    async createJob(jobId: string, phone: string, topic: string, payload: any, scheduledFor: Date) {
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

    async cancelJobsForOrder(orderId: string) {
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

        return jobs.map((j: any) => ({
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

export const databaseService = new DatabaseService();
