#!/bin/bash

# Script per l'installazione e configurazione dell'interfaccia web Lightstack
set -eEo pipefail

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funzioni di utilità
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verifica e ottieni l'utente reale anche quando si usa sudo
check_and_get_user() {
    # Verifica permessi di root
    if [ "$EUID" -ne 0 ]; then
        log_error "Questo script deve essere eseguito come root (usa sudo)"
        exit 1
    fi

    # Ottieni l'utente reale
    REAL_USER=$(who am i | awk '{print $1}')
    if [ -z "$REAL_USER" ]; then
        REAL_USER=$(logname 2>/dev/null || echo ${SUDO_USER:-${USER}})
    fi
    REAL_HOME=$(eval echo ~${REAL_USER})

    if [ -z "$REAL_USER" ] || [ -z "$REAL_HOME" ]; then
        log_error "Impossibile determinare l'utente reale"
        exit 1
    fi
}

# Verifica le dipendenze necessarie
check_dependencies() {
    local missing_deps=()

    log_info "Verifico le dipendenze di sistema..."

    # Lista delle dipendenze necessarie
    local deps=(
        "python3"
        "python3-pip"
        "python3-venv"
        "nodejs"
        "npm"
        "nginx"
        "certbot"
        "python3-certbot-nginx"
    )

    for dep in "${deps[@]}"; do
        if ! dpkg -l | grep -q "^ii  $dep "; then
            missing_deps+=("$dep")
        fi
    done

    # Se ci sono dipendenze mancanti, installale
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_warn "Dipendenze mancanti: ${missing_deps[*]}"
        log_info "Installazione delle dipendenze in corso..."
        
        # Aggiorna i repository
        apt-get update

        # Installa le dipendenze mancanti
        apt-get install -y "${missing_deps[@]}"
    fi

    # Verifica la versione di Node.js (richiede v14+)
    if ! node -v | grep -q "v1[4-9]"; then
        log_warn "Node.js versione 14+ richiesta. Aggiornamento in corso..."
        curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
        apt-get install -y nodejs
    fi
}

# Setup directories di installazione
setup_directories() {
    # Directory di installazione
    INSTALL_DIR="$REAL_HOME/lightstack-ui"
    BACKEND_DIR="$INSTALL_DIR/backend"
    FRONTEND_DIR="$INSTALL_DIR/frontend"
    
    log_info "Creo le directory di installazione..."
    
    # Crea le directory necessarie
    mkdir -p "$BACKEND_DIR" "$FRONTEND_DIR"
    chown -R "$REAL_USER:$REAL_USER" "$INSTALL_DIR"
}

# Setup backend
setup_backend() {
    log_info "Configuro il backend..."

    # Crea e attiva virtual environment
    cd "$BACKEND_DIR"
    python3 -m venv venv
    source venv/bin/activate

    # Installa dipendenze Python
    pip install fastapi uvicorn python-jose[cryptography] python-multipart

    # Copia i file del backend
    cp -r backend/* "$BACKEND_DIR/"

    # Genera una chiave segreta per JWT
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/your-secret-key/$JWT_SECRET/" "$BACKEND_DIR/main.py"

    # Crea il servizio systemd
    cat > /etc/systemd/system/lightstack-backend.service << EOF
[Unit]
Description=Lightstack Backend Service
After=network.target

[Service]
User=$REAL_USER
WorkingDirectory=$BACKEND_DIR
Environment="PATH=$BACKEND_DIR/venv/bin"
Environment="JWT_SECRET_KEY=$JWT_SECRET"
ExecStart=$BACKEND_DIR/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    # Aggiorna le credenziali admin
    sed -i "s/\"admin\"/\"$ADMIN_USER\"/" "$BACKEND_DIR/main.py"
    sed -i "s/\"adminpassword\"/\"$ADMIN_PASS\"/" "$BACKEND_DIR/main.py"

    deactivate

    systemctl daemon-reload
    systemctl enable lightstack-backend
}

# Setup frontend
setup_frontend() {
    log_info "Configuro il frontend..."
    
    cd "$FRONTEND_DIR"
    
    # Copia i file del frontend
    cp -r frontend/* ./
    
    # Installa dipendenze Node
    sudo -u "$REAL_USER" npm install
    
    # Costruisci l'applicazione
    sudo -u "$REAL_USER" npm run build
    
    # Aggiorna i permessi
    chown -R "$REAL_USER:$REAL_USER" "$FRONTEND_DIR"
}

# Setup Nginx
setup_nginx() {
    log_info "Configuro Nginx..."

    # Crea la configurazione Nginx
    cat > /etc/nginx/sites-available/lightstack << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        root $FRONTEND_DIR/dist;
        try_files \$uri \$uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    # Abilita il sito
    ln -sf /etc/nginx/sites-available/lightstack /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default

    # Verifica la configurazione
    nginx -t
    
    # Riavvia Nginx
    systemctl restart nginx
}

# Setup SSL con Certbot
setup_ssl() {
    log_info "Configuro SSL con Certbot..."

    # Ottieni e configura il certificato SSL
    certbot --nginx \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --domains "$DOMAIN" \
        --redirect

    # Aggiungi il rinnovo automatico a crontab
    if ! crontab -l | grep -q "certbot renew"; then
        (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    fi
}

# Backup di sicurezza
create_backup() {
    if [ -d "$INSTALL_DIR" ]; then
        local backup_dir="$REAL_HOME/lightstack-ui.backup.$(date +%Y%m%d_%H%M%S)"
        log_info "Creo backup dell'installazione esistente in: $backup_dir"
        cp -r "$INSTALL_DIR" "$backup_dir"
        chown -R "$REAL_USER:$REAL_USER" "$backup_dir"
    fi
}

# Menu principale
main() {
    clear
    log_info "Benvenuto nell'installazione di Lightstack UI"
    echo

    # Verifica requisiti base
    check_and_get_user
    check_dependencies
    
    # Richiedi informazioni
    read -p "Inserisci il dominio per l'interfaccia web (es: lightstack.tuodominio.com): " DOMAIN
    read -p "Inserisci l'indirizzo email per i certificati SSL: " EMAIL
    read -p "Inserisci il nome utente admin per l'interfaccia: " ADMIN_USER
    read -s -p "Inserisci la password per l'utente admin: " ADMIN_PASS
    echo
    echo
    
    # Conferma
    echo "Riepilogo configurazione:"
    echo "- Dominio: $DOMAIN"
    echo "- Email: $EMAIL"
    echo "- Utente admin: $ADMIN_USER"
    echo
    read -p "Vuoi procedere con l'installazione? (s/N): " CONFIRM
    
    if [[ ! $CONFIRM =~ ^[Ss]$ ]]; then
        log_info "Installazione annullata"
        exit 0
    fi
    
    # Backup
    create_backup
    
    # Installazione
    setup_directories
    setup_backend
    setup_frontend
    setup_nginx
    setup_ssl
    
    # Avvia i servizi
    log_info "Avvio i servizi..."
    systemctl start lightstack-backend
    systemctl restart nginx
    
    log_info "Installazione completata con successo!"
    echo
    echo "Puoi accedere all'interfaccia web su: https://$DOMAIN"
    echo "Credenziali di accesso:"
    echo "- Username: $ADMIN_USER"
    echo "- Password: [la password che hai inserito]"
    echo
    log_warn "Assicurati di salvare queste informazioni in un posto sicuro"
}

# Gestione errori
trap 'log_error "Si è verificato un errore durante l'\''installazione. Controlla i log per maggiori dettagli."' ERR

# Avvio dello script
main
