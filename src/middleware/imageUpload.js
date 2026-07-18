const path = require('path');
const multer = require('multer');
const AppError = require('../utils/AppError');

const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MESSAGE = 'Only JPG, PNG, WEBP, HEIC, HEIF, and AVIF images are allowed';
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.avif']);
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/avif',
]);
const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const ISO_IMAGE_BRANDS = new Set([
    'avif',
    'avis',
    'heic',
    'heix',
    'hevc',
    'hevx',
    'heim',
    'heis',
    'hevm',
    'hevs',
    'mif1',
    'msf1',
]);

function getFileExtension(file) {
    return path.extname(file?.originalname || '').toLowerCase();
}

function getMimeType(file) {
    return String(file?.mimetype || '').toLowerCase();
}

function looksLikePotentialImage(file) {
    const extension = getFileExtension(file);
    const mimetype = getMimeType(file);

    return (
        ALLOWED_EXTENSIONS.has(extension) ||
        ALLOWED_MIME_TYPES.has(mimetype) ||
        GENERIC_MIME_TYPES.has(mimetype) ||
        mimetype.startsWith('image/')
    );
}

function startsWithBytes(buffer, signature) {
    if (!Buffer.isBuffer(buffer) || buffer.length < signature.length) return false;
    return signature.every((byte, index) => buffer[index] === byte);
}

function readAscii(buffer, start, end) {
    if (!Buffer.isBuffer(buffer) || buffer.length < end) return '';
    return buffer.subarray(start, end).toString('ascii');
}

function detectIsoImageType(buffer) {
    if (readAscii(buffer, 4, 8) !== 'ftyp') return null;

    const headerLength = Math.min(buffer.length, 64);
    for (let offset = 8; offset + 4 <= headerLength; offset += 4) {
        const brand = readAscii(buffer, offset, offset + 4).trim().toLowerCase();
        if (!ISO_IMAGE_BRANDS.has(brand)) continue;
        return brand.startsWith('av') ? 'avif' : 'heif';
    }

    return null;
}

function detectImageType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
    if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
    if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (buffer.length >= 12 && readAscii(buffer, 0, 4) === 'RIFF' && readAscii(buffer, 8, 12) === 'WEBP') {
        return 'webp';
    }

    return detectIsoImageType(buffer);
}

function validateUploadedImageFile(file) {
    if (!file) return;

    const detectedType = detectImageType(file.buffer);
    if (!detectedType) {
        throw new AppError(ALLOWED_IMAGE_MESSAGE, 400);
    }

    file.detectedImageType = detectedType;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        if (!looksLikePotentialImage(file)) {
            return cb(new AppError(ALLOWED_IMAGE_MESSAGE, 400));
        }

        cb(null, true);
    },
});

function uploadSingleImage(fieldName = 'image') {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return next(new AppError('Image must be 5 MB or smaller', 400));
                }

                return next(new AppError(err.message, 400));
            }

            if (err) return next(err);

            try {
                validateUploadedImageFile(req.file);
            } catch (validationError) {
                return next(validationError);
            }

            next();
        });
    };
}

module.exports = {
    uploadSingleImage,
    validateUploadedImageFile,
    detectImageType,
    MAX_IMAGE_FILE_SIZE_BYTES,
};
