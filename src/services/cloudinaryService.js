const { v2: cloudinary } = require('cloudinary');
const config = require('../config');
const AppError = require('../utils/AppError');

let configured = false;

function assertConfigured() {
    const { cloudName, apiKey, apiSecret } = config.cloudinary;
    if (!cloudName || !apiKey || !apiSecret) {
        throw new AppError(
            'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
            500
        );
    }

    if (!configured) {
        cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
            secure: true,
        });
        configured = true;
    }
}

function sanitizePathSegment(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function buildCloudinaryFolder(...parts) {
    return [config.cloudinary.folder, ...parts]
        .flatMap((part) => String(part || '').split('/'))
        .map(sanitizePathSegment)
        .filter(Boolean)
        .join('/');
}

function uploadBuffer(buffer, options) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });

        uploadStream.end(buffer);
    });
}

exports.uploadImage = async function uploadImage(file, { folder, publicId } = {}) {
    if (!file || !file.buffer) {
        throw new AppError('Image file is required', 400);
    }

    assertConfigured();

    let result;
    try {
        result = await uploadBuffer(file.buffer, {
            resource_type: 'image',
            folder,
            public_id: publicId ? sanitizePathSegment(publicId) : undefined,
            overwrite: true,
        });
    } catch (err) {
        throw new AppError(`Cloudinary upload failed: ${err.message}`, 502);
    }

    const url = result.secure_url || result.url;
    if (!url) {
        throw new AppError('Cloudinary upload did not return an image URL', 502);
    }

    return {
        url,
        public_id: result.public_id,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        format: result.format,
    };
};

exports.destroyImage = async function destroyImage(publicId) {
    if (!publicId) return { result: 'not_found' };

    assertConfigured();

    let result;
    try {
        result = await cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
            invalidate: true,
        });
    } catch (err) {
        throw new AppError(`Cloudinary delete failed: ${err.message}`, 502);
    }

    if (!['ok', 'not found'].includes(result.result)) {
        throw new AppError(result.error?.message || `Cloudinary delete failed: ${result.result || 'unknown result'}`, 502);
    }

    return result;
};

exports.buildCloudinaryFolder = buildCloudinaryFolder;
