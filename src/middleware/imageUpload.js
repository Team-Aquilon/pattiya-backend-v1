const path = require('path');
const multer = require('multer');
const AppError = require('../utils/AppError');

const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        const extension = path.extname(file.originalname || '').toLowerCase();
        const validExtension = ALLOWED_EXTENSIONS.has(extension);
        const validMimeType = ALLOWED_MIME_TYPES.has(file.mimetype);

        if (!validExtension || !validMimeType) {
            return cb(new AppError('Only JPG, PNG, and WEBP images are allowed', 400));
        }

        cb(null, true);
    },
});

function uploadSingleImage(fieldName = 'image') {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (!err) return next();

            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return next(new AppError('Image must be 5 MB or smaller', 400));
                }

                return next(new AppError(err.message, 400));
            }

            next(err);
        });
    };
}

module.exports = {
    uploadSingleImage,
    MAX_IMAGE_FILE_SIZE_BYTES,
};
