const crypto = require('crypto');
const config = require('../config');
const AppError = require('../utils/AppError');

const CLOUDINARY_UPLOAD_BASE_URL = 'https://api.cloudinary.com/v1_1';

function assertConfigured() {
    const { cloudName, apiKey, apiSecret } = config.cloudinary;
    if (!cloudName || !apiKey || !apiSecret) {
        throw new AppError(
            'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
            500
        );
    }

    if (typeof fetch !== 'function' || typeof FormData !== 'function') {
        throw new AppError('Cloudinary uploads require Node.js 18 or newer.', 500);
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

function buildSignature(params, apiSecret) {
    const payload = Object.keys(params)
        .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');

    return crypto.createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

function appendUploadParam(form, params, key, value) {
    if (value === undefined || value === null || value === '') return;
    params[key] = value;
    form.append(key, String(value));
}

async function parseCloudinaryBody(response) {
    const text = await response.text();
    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch (_err) {
        return { message: text };
    }
}

exports.uploadImage = async function uploadImage(file, { folder, publicId } = {}) {
    if (!file || !file.buffer) {
        throw new AppError('Image file is required', 400);
    }

    assertConfigured();

    const { cloudName, apiKey, apiSecret } = config.cloudinary;
    const uploadUrl = `${CLOUDINARY_UPLOAD_BASE_URL}/${encodeURIComponent(cloudName)}/image/upload`;
    const params = {};
    const form = new FormData();
    const timestamp = Math.floor(Date.now() / 1000);

    form.append('file', `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
    form.append('api_key', apiKey);
    appendUploadParam(form, params, 'timestamp', timestamp);
    appendUploadParam(form, params, 'folder', folder);
    appendUploadParam(form, params, 'public_id', publicId ? sanitizePathSegment(publicId) : '');
    appendUploadParam(form, params, 'overwrite', true);

    form.append('signature', buildSignature(params, apiSecret));

    let response;
    try {
        response = await fetch(uploadUrl, {
            method: 'POST',
            body: form,
        });
    } catch (err) {
        throw new AppError(`Cloudinary upload failed: ${err.message}`, 502);
    }

    const data = await parseCloudinaryBody(response);
    if (!response.ok) {
        throw new AppError(data.error?.message || data.message || 'Cloudinary upload failed', response.status);
    }

    const url = data.secure_url || data.url;
    if (!url) {
        throw new AppError('Cloudinary upload did not return an image URL', 502);
    }

    return {
        url,
        public_id: data.public_id,
        width: data.width,
        height: data.height,
        bytes: data.bytes,
        format: data.format,
    };
};

exports.buildCloudinaryFolder = buildCloudinaryFolder;
