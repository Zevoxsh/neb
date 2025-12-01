/**
 * Controller Factory
 * Reduces duplication across CRUD controllers
 */

const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

/**
 * Create a standard CRUD controller for a model
 * @param {Object} model - Model with CRUD methods
 * @param {string} resourceName - Human-readable resource name (e.g., 'Backend', 'Domain')
 * @param {Object} options - Optional configuration
 * @returns {Object} Controller with list, create, update, remove methods
 */
function createCRUDController(model, resourceName, options = {}) {
    const logger = createLogger(`${resourceName}Controller`);
    const {
        listMethod = 'list' + resourceName + 's',
        createMethod = 'create' + resourceName,
        updateMethod = 'update' + resourceName,
        deleteMethod = 'delete' + resourceName,
        getByIdMethod = 'get' + resourceName + 'ById',
        onAfterCreate = null,
        onAfterUpdate = null,
        onAfterDelete = null,
        validateCreate = null,
        validateUpdate = null
    } = options;

    return {
        /**
         * List all resources
         */
        list: asyncHandler(async (req, res) => {
            logger.debug('Listing resources');
            const rows = await model[listMethod]();
            res.json(rows || []);
        }),

        /**
         * Get single resource by ID
         */
        getById: asyncHandler(async (req, res) => {
            const id = parseInt(req.params.id, 10);
            if (!id || isNaN(id)) {
                throw new AppError('Invalid ID', 400);
            }

            logger.debug(`Getting resource`, { id });
            const resource = await model[getByIdMethod](id);

            if (!resource) {
                throw new AppError(`${resourceName} not found`, 404);
            }

            res.json(resource);
        }),

        /**
         * Create new resource
         */
        create: asyncHandler(async (req, res) => {
            logger.debug(`Creating resource`, { body: req.body });

            // Custom validation if provided
            if (validateCreate) {
                const validation = validateCreate(req.body);
                if (!validation.valid) {
                    throw new AppError(validation.message || 'Validation failed', 400, validation.details);
                }
            }

            const resource = await model[createMethod](req.body);
            logger.info(`Created resource`, { id: resource.id });

            // Post-create hook
            if (onAfterCreate) {
                setImmediate(() => {
                    onAfterCreate(resource).catch(err => {
                        logger.error('After-create hook failed', { error: err.message });
                    });
                });
            }

            res.status(201).json(resource);
        }),

        /**
         * Update existing resource
         */
        update: asyncHandler(async (req, res) => {
            const id = parseInt(req.params.id, 10);
            if (!id || isNaN(id)) {
                throw new AppError('Invalid ID', 400);
            }

            logger.debug(`Updating resource`, { id, body: req.body });

            // Custom validation if provided
            if (validateUpdate) {
                const validation = validateUpdate(req.body, id);
                if (!validation.valid) {
                    throw new AppError(validation.message || 'Validation failed', 400, validation.details);
                }
            }

            const resource = await model[updateMethod](id, req.body);

            if (!resource) {
                throw new AppError(`${resourceName} not found`, 404);
            }

            logger.info(`Updated resource`, { id });

            // Post-update hook
            if (onAfterUpdate) {
                setImmediate(() => {
                    onAfterUpdate(resource, id).catch(err => {
                        logger.error('After-update hook failed', { error: err.message });
                    });
                });
            }

            res.json(resource);
        }),

        /**
         * Delete resource
         */
        remove: asyncHandler(async (req, res) => {
            const id = parseInt(req.params.id, 10);
            if (!id || isNaN(id)) {
                throw new AppError('Invalid ID', 400);
            }

            logger.debug(`Deleting resource`, { id });
            await model[deleteMethod](id);
            logger.info(`Deleted resource`, { id });

            // Post-delete hook
            if (onAfterDelete) {
                setImmediate(() => {
                    onAfterDelete(id).catch(err => {
                        logger.error('After-delete hook failed', { error: err.message });
                    });
                });
            }

            res.sendStatus(204);
        })
    };
}

module.exports = { createCRUDController };
