/**
 * Joi validation middleware factory.
 * 
 * Usage:
 *   const { body, query } = require('./validate');
 *   router.post('/endpoint', body(someJoiSchema), handler);
 *   router.get('/endpoint', query(someJoiSchema), handler);
 */

const validateSource = (source) => (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], {
            abortEarly: false,
            stripUnknown: true,
        });

        if (error) {
            const details = error.details.map((d) => d.message);
            return res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                errors: details,
            });
        }

        // Replace request data with validated & sanitized values
        req[source] = value;
        next();
    };
};

module.exports = {
    body: validateSource('body'),
    query: validateSource('query'),
    params: validateSource('params'),
};
