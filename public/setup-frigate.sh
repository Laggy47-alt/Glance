#!/bin/bash
# ================================================
# Dynamic Frigate + Mosquitto + Notify Installer
# Usage: sudo bash setup-frigate-site.sh <site-name>
# ================================================

if [ -z "$1" ]; then
  echo "Usage: sudo $0 <site-name>"
  echo "Example: sudo $0 site_name"
  exit 1
fi

SITE_NAME="$1"
TOPIC_PREFIX="$SITE_NAME"
WEBHOOK_SLUG="frigate-${SITE_NAME}-$(date +%s | tail -c 6)"

# ==================== IMPROVED IP DETECTION ====================
echo "Detecting primary IP address..."
NUC_IP=$(ip route get 1.1.1.1 | awk '{print $7}' | head -n1)

if [ -z "$NUC_IP" ] || ! [[ $NUC_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NUC_IP=$(hostname -I | awk '{print $1}')
fi

echo "✅ Detected IP: ${NUC_IP}"

echo "=== Setting up Frigate Site: ${SITE_NAME} ==="
echo "========================================"

# Update system + Docker (unchanged)
apt-get update && apt-get upgrade -y
apt-get install -y openssh-server curl ca-certificates gnupg lsb-release
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker $SUDO_USER

# Directory structure
cd /home/$SUDO_USER
rm -rf frigate-${SITE_NAME}
mkdir -p frigate-${SITE_NAME}/{config,storage,clips,cache,mosquitto/{config,data}}
cd frigate-${SITE_NAME}

# Webhook prompt
echo ""
echo "=== Webhook Configuration ==="
read -p "Enter full Webhook URL: " WEBHOOK_URL
read -p "Enter Webhook Secret: " WEBHOOK_SECRET

# ==================== Mosquitto Config ====================
cat > mosquitto/config/mosquitto.conf << EOF
listener 1883
allow_anonymous true
persistence true
persistence_location /mosquitto/data/
log_dest stdout
EOF

# ==================== Frigate Config (Updated with your settings) ====================
cat > config/config.yml << EOF
mqtt:
  enabled: true
  host: mosquitto
  port: 1883
  topic_prefix: ${TOPIC_PREFIX}

# ==================== Your Global Settings ====================
detect:
  enabled: true

record:
  enabled: true
  alerts:
    retain: {}
    pre_capture: 5
    post_capture: 5
  detections:
    retain: {}
    pre_capture: 5
    post_capture: 5
  continuous:
    days: 14
  motion:
    days: 14

review:
  alerts:
    required_zones:
      - zone1
  detections:
    required_zones:
      - zone1

snapshots:
  enabled: true
  retain:
    default: 30
  bounding_box: true
  required_zones:
    - zone1

objects:
  track:
    - person

# ==================== Camera Example ====================
cameras:
  test_camera:
    ffmpeg:
      inputs:
        - path: rtsp://YOUR_CAMERA_IP:554/stream1
          roles:
            - detect
    detect:
      enabled: true
      width: 640
      height: 360
      fps: 5

detectors:
  cpu:
    type: cpu

ffmpeg:
  hwaccel_args: preset-vaapi
EOF

# ==================== Notify Config ====================
cat > notify-config.yml << EOF
app:
  mode: events

frigate:
  server: "http://frigate:5000"
  mqtt:
    enabled: true
    server: "mosquitto"
    port: 1883
    topic_prefix: ${TOPIC_PREFIX}

alerts:
  general:
    title: "${SITE_NAME^} Alert"
    snap_bbox: true
    snap_timestamp: true
  dedupe:
    enabled: true
    timeout: 8
  filters:
    require_alert: true

webhook:
  enabled: true
  server: "${WEBHOOK_URL}"
  method: POST
  headers:
    Content-Type: "application/json"
    X-Webhook-Secret: "${WEBHOOK_SECRET}"
  template: |
    {
      "event_id": "{{ .ID }}",
      "camera": "{{ .Camera }}",
      "label": "{{ .Label }}",
      "score": "{{ .Extra.TopScorePercent }}",
      "snapshot_url": "http://${NUC_IP}:5000/api/events/{{ .ID }}/snapshot.jpg?bbox=1",
      "clip_url": "http://${NUC_IP}:5000/api/events/{{ .ID }}/clip.mp4"
    }
EOF

# ==================== Docker Compose ====================
cat > docker-compose.yml << EOF
version: "3.9"

services:
  frigate:
    container_name: frigate
    image: ghcr.io/blakeblackshear/frigate:stable
    restart: unless-stopped
    privileged: true
    network_mode: host
    devices:
      - /dev/dri:/dev/dri
    ports:
      - "5000:5000"
      - "8971:8971"
    volumes:
      - ./config:/config
      - ./storage:/media/frigate
      - ./clips:/clips
      - ./cache:/cache
    environment:
      - TZ=Africa/Johannesburg
    shm_size: "1gb"

  mosquitto:
    container_name: mosquitto
    image: eclipse-mosquitto:latest
    restart: unless-stopped
    ports:
      - "1883:1883"
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - ./mosquitto/data:/mosquitto/data

  frigate-notify:
    container_name: frigate-notify
    image: ghcr.io/0x2142/frigate-notify:latest
    restart: unless-stopped
    volumes:
      - ./notify-config.yml:/app/config.yml:ro
    depends_on:
      - frigate
      - mosquitto
    environment:
      - TZ=Africa/Johannesburg

  cloudflared:
    container_name: cloudflared
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --url http://frigate:5000
EOF

echo "Starting services..."
docker compose up -d

echo ""
echo "========================================"
echo "✅ Setup Complete for Site: ${SITE_NAME}"
echo "Frigate UI     → http://${NUC_IP}:5000"
echo "MQTT Broker    → ${NUC_IP}:1883"
echo ""
docker logs cloudflared --tail 15
echo "========================================"
