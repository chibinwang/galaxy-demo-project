import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: string[],
  ) {
    super(message);
  }
}

export const bad = (message: string, details?: string[]) => new HttpError(400, message, details);
export const notFound = (what: string) => new HttpError(404, `${what} not found`);

export type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
export const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

export const q = (req: Request, key: string) => (typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined);

