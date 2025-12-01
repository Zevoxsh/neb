/**
 * Backend Controller (Refactored with utilities)
 */

const backendModel = require('../models/backendModel');
const proxyManager = require('../services/proxyManager');
const { createCRUDController } = require('../utils/controllerFactory');

// Create base CRUD controller with factory
const baseCRUD = createCRUDController(
  backendModel,
  'Backend',
  {
    listMethod: 'listBackends',
    createMethod: 'createBackend',
    updateMethod: 'updateBackend',
    deleteMethod: 'deleteBackend',
    getByIdMethod: 'getBackendById',

    // Validation hooks
    validateCreate: (data) => {
      if (!data.name || !data.targetHost || !data.targetPort) {
        return { valid: false, message: 'Missing required fields: name, targetHost, targetPort' };
      }
      return { valid: true };
    },

    validateUpdate: (data) => {
      if (!data.name || !data.targetHost || !data.targetPort) {
        return { valid: false, message: 'Missing required fields: name, targetHost, targetPort' };
      }
      return { valid: true };
    },

    // Post-action hooks - reload proxies after any backend change
    onAfterCreate: async (resource) => {
      await proxyManager.reloadAllProxies();
    },

    onAfterUpdate: async (resource, id) => {
      await proxyManager.reloadAllProxies();
    },

    onAfterDelete: async (id) => {
      await proxyManager.reloadAllProxies();
    }
  }
);

// Export controller methods
module.exports = {
  list: baseCRUD.list,
  create: baseCRUD.create,
  update: baseCRUD.update,
  remove: baseCRUD.remove
};
