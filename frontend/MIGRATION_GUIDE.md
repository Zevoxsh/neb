# Nebula Frontend Migration Guide

## 🎯 Objectif
Refonte complète du frontend pour avoir une interface cohérente, moderne et professionnelle.

## ✅ Ce qui a été fait

### 1. Système de composants réutilisables (`/public/js/components.js`)
Fonctions globales disponibles partout :
- `showToast()` - Notifications
- `createLoadingSpinner()` - États de chargement
- `createEmptyState()` - États vides
- `createErrorState()` - États d'erreur
- `createBadge()` - Badges colorés
- `createStatusBadge()` - Badges actif/inactif
- `createProtocolBadge()` - Badges de protocole
- `apiRequest()` - Helper API unifié
- `escapeHtml()` - Échappement HTML sécurisé
- Et plus...

### 2. Pages refaites (cohérentes)
- ✅ `/add-domain` - Formulaire de création de domaine (moderne, 3 étapes)
- ✅ `/domains` - Liste des domaines (stats, recherche, édition)
- ✅ `components.js` - Bibliothèque de composants

### 3. Design System
Le fichier `/public/nebula-v2.css` contient :
- Variables CSS cohérentes
- Palette de couleurs unifiée
- Espacements standardisés
- Composants réutilisables

## 📋 Architecture Frontend

### Structure des pages

```
frontend/public/
├── js/
│   ├── components.js      ← 🆕 Composants réutilisables
│   ├── api.js             ← Helper API
│   ├── app.js             ← Logique legacy (à migrer)
│   └── theme.js           ← Gestion du thème
├── partials/
│   ├── sidebar.html       ← Menu latéral
│   ├── header.html        ← En-tête
│   └── footer.html        ← Pied de page
└── *.html                 ← Pages

```

### Template de page moderne

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Page - Nebula</title>
  <link rel="stylesheet" href="/public/nebula-v2.css">
  <script src="/public/js/components.js" defer></script>
  <script src="/public/js/include-partials.js" defer></script>
</head>

<body data-page="page-name">
  <div class="app-shell">
    <div id="sidebar-placeholder"></div>

    <div class="app-main">
      <header class="topbar">
        <div class="page-heading">
          <p class="eyebrow">Section</p>
          <h1>Title</h1>
          <p class="muted">Description</p>
        </div>
        <div class="topbar-actions">
          <button class="btn primary">Action</button>
        </div>
      </header>

      <section class="page-content">
        <!-- Content here -->
      </section>

      <div id="footer-placeholder"></div>
    </div>
  </div>

  <script>
    // Page-specific logic
    document.addEventListener('DOMContentLoaded', () => {
      loadPageData();
    });

    async function loadPageData() {
      const result = await apiRequest('/api/endpoint');
      if (result.success) {
        // Handle data
      } else {
        showToast(result.error, 'error');
      }
    }
  </script>
</body>
</html>
```

## 🎨 Composants UI standardisés

### Stats Cards
```javascript
// Dans le HTML
<div class="stats-grid" id="stats"></div>

// Dans le JS
document.getElementById('stats').innerHTML = `
  <div class="stat-card">
    <div class="stat-icon">🔌</div>
    <div class="stat-content">
      <div class="stat-value">42</div>
      <div class="stat-label">Total Proxies</div>
    </div>
  </div>
`;
```

### Card avec actions
```javascript
const card = `
  <div class="card">
    <div class="card-header">
      <div>
        <h2 class="card-title">Title</h2>
        <p class="card-subtitle">Subtitle</p>
      </div>
      <button class="btn primary">Action</button>
    </div>
    <div class="card-body">
      Content
    </div>
  </div>
`;
```

### Liste de ressources
```javascript
const list = `
  <div class="resource-list">
    <div class="resource-item">
      <div class="resource-info">
        <div class="resource-name">example.com</div>
        <div class="resource-meta">
          ${createProtocolBadge('https')}
          <span class="meta-text">Port 443</span>
        </div>
      </div>
      <div class="resource-status">
        ${createStatusBadge(true)}
      </div>
    </div>
  </div>
`;
```

### Modal
```html
<div class="modal-overlay" id="myModal" style="display: none;">
  <div class="modal-card">
    <div class="modal-header">
      <h2>Title</h2>
      <button class="btn ghost" onclick="closeModal('myModal')">✕</button>
    </div>
    <div class="modal-body">
      Content
    </div>
  </div>
</div>
```

## 🔄 Migration d'une page existante

### Avant (ancien style)
```html
<div id="content">
  <!-- Code ancien, incohérent -->
</div>
<script>
  // Logique mélangée dans app.js
</script>
```

### Après (nouveau style)
```html
<section class="page-content">
  <div class="stats-grid" id="stats"></div>
  <div id="dataContainer"></div>
</section>

<script>
  document.addEventListener('DOMContentLoaded', initPage);

  async function initPage() {
    const result = await apiRequest('/api/data');
    if (result.success) {
      renderData(result.data);
    } else {
      document.getElementById('dataContainer').innerHTML =
        createErrorState('Failed to load', result.error, 'initPage()');
    }
  }

  function renderData(data) {
    // Render logic
  }
</script>
```

## 🚀 Prochaines étapes

Pour terminer la refonte :

1. **Migrer Dashboard**
   - Stats en temps réel
   - Quick actions
   - Aperçu des ressources

2. **Migrer Proxies**
   - Liste avec filtres
   - Création/édition
   - Gestion des erreurs

3. **Migrer Backends**
   - Health status
   - Métriques
   - Configuration

4. **Migrer Certificates**
   - Liste des certificats
   - Génération ACME
   - Statuts de renouvellement

## 📚 Conventions de code

### Naming
- Classes CSS: kebab-case (`stat-card`)
- IDs: camelCase (`statsGrid`)
- Fonctions JS: camelCase (`loadDomains`)
- Constantes: UPPER_CASE (`API_BASE_URL`)

### Structure HTML
```html
<!-- Toujours cette hiérarchie -->
<div class="app-shell">
  <div id="sidebar-placeholder"></div>
  <div class="app-main">
    <header class="topbar">...</header>
    <section class="page-content">...</section>
    <div id="footer-placeholder"></div>
  </div>
</div>
```

### Gestion d'état
```javascript
let pageData = {};  // State local

async function loadData() {
  const result = await apiRequest('/api/endpoint');
  if (result.success) {
    pageData = result.data;
    render();
  }
}

function render() {
  // Render based on pageData
}
```

## 🎯 Checklist Migration

Pour chaque page :
- [ ] Importer `components.js`
- [ ] Utiliser la structure `app-shell`
- [ ] Header avec `topbar`
- [ ] Stats avec `stats-grid`
- [ ] Loading states avec `createLoadingSpinner()`
- [ ] Empty states avec `createEmptyState()`
- [ ] Error handling avec `createErrorState()`
- [ ] Toasts avec `showToast()`
- [ ] API calls avec `apiRequest()`
- [ ] Escape HTML avec `escapeHtml()`

## 🐛 Debug

En cas de problème :
```javascript
console.log('[PageName] Debug info:', data);
```

Vérifier que components.js est chargé :
```javascript
if (typeof showToast === 'undefined') {
  console.error('components.js not loaded!');
}
```

## ✨ Résultat attendu

Après migration complète :
- ✅ UI cohérente sur toutes les pages
- ✅ Code DRY (Don't Repeat Yourself)
- ✅ Maintenance facile
- ✅ Performances optimisées
- ✅ UX professionnelle
