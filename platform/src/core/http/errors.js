// Uniform error envelope + typed HTTP errors.
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg, d) => new HttpError(400, 'bad_request', msg || 'طلب غير صالح', d);
export const unauthorized = (msg) => new HttpError(401, 'unauthorized', msg || 'يلزم تسجيل الدخول');
export const forbidden = (msg) => new HttpError(403, 'forbidden', msg || 'صلاحيتك لا تسمح بهذا الإجراء');
export const notFound = (msg) => new HttpError(404, 'not_found', msg || 'غير موجود');
export const conflict = (msg) => new HttpError(409, 'conflict', msg || 'تعارض');

export function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({
      error: { code: err.code || 'internal', message: err.message || 'خطأ داخلي', details: err.details || null },
    });
  };
}
