/**
 * Maintenance Routes
 * API endpoints for managing domain maintenance mode
 */

const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenanceController');

// List all domains with their maintenance status
router.get('/status', maintenanceController.listStatus);

// List domains currently in maintenance mode
router.get('/active', maintenanceController.listInMaintenance);

// Get maintenance status for specific domain
router.get('/status/:id', maintenanceController.getStatus);

// Set maintenance mode for a domain
router.put('/mode/:id', maintenanceController.setMaintenanceMode);

// Upload custom maintenance page for a domain
router.post('/page/:id', maintenanceController.uploadMaintenancePage);

// Get maintenance page content for a domain
router.get('/page/:id', maintenanceController.getMaintenancePage);

// Delete custom maintenance page for a domain
router.delete('/page/:id', maintenanceController.deleteMaintenancePage);

module.exports = router;
