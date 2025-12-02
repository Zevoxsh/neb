# Translation script - French to English
$translations = @{
    # Common UI
    'Système' = 'System'
    'Gestion' = 'Management'
    'Configuration' = 'Configuration'
    'Paramètres' = 'Settings'
    'Sécurité' = 'Security'
    'Alertes' = 'Alerts'
    'Domaines' = 'Domains'
    'Requêtes' = 'Requests'
    'Métriques' = 'Metrics'
    'Certificats' = 'Certificates'
    
    # Actions
    'Sauvegarder' = 'Save'
    'Sauvegarder Tout' = 'Save All'
    'Annuler' = 'Cancel'
    'Supprimer' = 'Delete'
    'Modifier' = 'Edit'
    'Créer' = 'Create'
    'Ajouter' = 'Add'
    'Enregistrer' = 'Save'
    'Fermer' = 'Close'
    'Redémarrer' = 'Restart'
    'Exporter .env' = 'Export .env'
    'Réinitialiser' = 'Reset'
    'Tester la connexion' = 'Test Connection'
    'Gerer' = 'Manage'
    
    # Messages
    'Succès' = 'Success'
    'Erreur' = 'Error'
    'Attention' = 'Warning'
    'Confirmer' = 'Confirm'
    'Voulez-vous vraiment' = 'Do you really want to'
    'Êtes-vous sûr' = 'Are you sure'
    'Opération réussie' = 'Operation successful'
    'Une erreur est survenue' = 'An error occurred'
    'Chargement' = 'Loading'
    'Aucun résultat' = 'No results'
    'Rechercher' = 'Search'
    'Connexion à la base de données échouée' = 'Database connection failed'
    'Impossible de se connecter à la base de données PostgreSQL' = 'Unable to connect to PostgreSQL database'
    'Base de données reconnectée' = 'Database reconnected'
    
    # Config page
    'Gestion centralisée de tous les paramètres' = 'Centralized management of all settings'
    'Ces paramètres modifient le fichier' = 'These settings modify the file'
    'Un redémarrage de l''application sera nécessaire après la sauvegarde' = 'Application restart will be required after save'
    'Recharger la configuration maintenant' = 'Reload configuration now'
    'Les nouvelles valeurs de la base de données seront appliquées' = 'New database values will be applied'
    'Rechargement de la configuration' = 'Reloading configuration'
    'Configuration rechargée' = 'Configuration reloaded'
    'DB reste inaccessible' = 'DB remains unreachable'
    'Erreur inconnue' = 'Unknown error'
    'Erreur lors du rechargement de la configuration' = 'Error while reloading configuration'
    'Réinitialiser tous les paramètres de' = 'Reset all settings for'
    'paramètres sauvegardés' = 'settings saved'
    'Veuillez redémarrer manuellement l''application' = 'Please restart the application manually'
    
    # Categories
    'Base de données' = 'Database'
    'Sécurité & JWT' = 'Security & JWT'
    'Bot Protection' = 'Bot Protection'
    'Sécurité IP' = 'IP Security'
    
    # Install page
    'Configuration initiale de votre reverse proxy' = 'Initial configuration of your reverse proxy'
    'Configuration PostgreSQL' = 'PostgreSQL Configuration'
    'Configuration Sécurité' = 'Security Configuration'
    'Modifier les paramètres de mapping et de protection du domaine' = 'Modify domain mapping and protection settings'
    
    # Labels
    'Hôte' = 'Host'
    'Port' = 'Port'
    'Utilisateur' = 'User'
    'Mot de passe' = 'Password'
    'Nom de la base' = 'Database Name'
    'Email ACME' = 'ACME Email'
    'TLDs locaux' = 'Local TLDs'
    'Activé' = 'Enabled'
    'Seuil global' = 'Global Threshold'
    'Limite par IP' = 'Per IP Limit'
    'Limite domaines protégés' = 'Protected Domains Limit'
    'Limite IP vérifiées' = 'Verified IP Limit'
    'Limite burst' = 'Burst Limit'
    'Connexions max par IP' = 'Max Connections per IP'
    'Tentatives max challenge' = 'Max Challenge Attempts'
    'Durée vérification' = 'Verification Duration'
    'Challenge 1ère visite' = 'Challenge First Visit'
    'Intervalle health check' = 'Health Check Interval'
    'Seuil d''échecs' = 'Failure Threshold'
    'Timeout health check' = 'Health Check Timeout'
    'Délai entre alertes' = 'Alert Cooldown'
    'Blocage auto IPs' = 'Auto Block IPs'
    'Seuil bytes par IP' = 'Bytes Threshold per IP'
    'Seuil requêtes par IP' = 'Requests Threshold per IP'
    'Intervalle flush métriques' = 'Metrics Flush Interval'
    'Taille max buffer' = 'Max Buffer Size'
    
    # Alert/Security pages
    'Alertes de Sécurité' = 'Security Alerts'
    'Surveillance des événements de sécurité et menaces détectées' = 'Monitoring security events and detected threats'
    'Événements de sécurité' = 'Security Events'
    
    # Notifications
    'Erreur de chargement de la configuration' = 'Configuration loading error'
    'Erreur lors du test de connexion' = 'Connection test error'
    'Connexion à la base de données réussie' = 'Database connection successful'
    'Connexion échouée' = 'Connection failed'
    'Erreur lors de la récupération des valeurs runtime' = 'Error retrieving runtime values'
    
    # Debug
    'Valeurs Runtime Actuelles' = 'Current Runtime Values'
    'Ces valeurs sont en cours d''utilisation par l''application' = 'These values are currently used by the application'
}

# Apply translations to HTML files
Write-Host "Translating HTML files..." -ForegroundColor Cyan
Get-ChildItem -Path "frontend/public/*.html" | ForEach-Object {
    Write-Host "  Processing $($_.Name)..." -ForegroundColor Gray
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    foreach($key in $translations.Keys) {
        $content = $content -replace [regex]::Escape($key), $translations[$key]
    }
    Set-Content $_.FullName $content -NoNewline -Encoding UTF8
}

# Apply translations to JS files
Write-Host "Translating JS files..." -ForegroundColor Cyan
Get-ChildItem -Path "frontend/public/js/*.js" | ForEach-Object {
    Write-Host "  Processing $($_.Name)..." -ForegroundColor Gray
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    foreach($key in $translations.Keys) {
        $content = $content -replace [regex]::Escape($key), $translations[$key]
    }
    Set-Content $_.FullName $content -NoNewline -Encoding UTF8
}

# Apply translations to partials
Write-Host "Translating partials..." -ForegroundColor Cyan
Get-ChildItem -Path "frontend/public/partials/*.html" | ForEach-Object {
    Write-Host "  Processing $($_.Name)..." -ForegroundColor Gray
    $content = Get-Content $_.FullName -Raw -Encoding UTF8
    foreach($key in $translations.Keys) {
        $content = $content -replace [regex]::Escape($key), $translations[$key]
    }
    Set-Content $_.FullName $content -NoNewline -Encoding UTF8
}

Write-Host "`nTranslation completed!" -ForegroundColor Green
