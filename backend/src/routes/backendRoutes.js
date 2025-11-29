const express = require('express');
const router = express.Router();
const backendController = require('../controllers/backendController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/backends', authenticateToken, backendController.list);
router.post('/api/backends', authenticateToken, backendController.create);
router.delete('/api/backends/:id', authenticateToken, backendController.remove);
router.put('/api/backends/:id', authenticateToken, backendController.update);

module.exports = router;
