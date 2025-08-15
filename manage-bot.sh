#!/bin/bash

# SolTools Dex Bot Management Script
# Usage: ./manage-bot.sh [start|stop|restart|status|logs|dev|prod]

SERVICE_NAME="soltools-dexbot"
DEV_SERVICE_NAME="soltools-dexbot-dev"

case "$1" in
    start)
        echo "🚀 Starting SolTools Dex Bot..."
        systemctl start $SERVICE_NAME
        systemctl status $SERVICE_NAME --no-pager
        ;;
    stop)
        echo "🛑 Stopping SolTools Dex Bot..."
        systemctl stop $SERVICE_NAME
        systemctl stop $DEV_SERVICE_NAME 2>/dev/null
        echo "✅ Bot stopped"
        ;;
    restart)
        echo "🔄 Restarting SolTools Dex Bot..."
        systemctl restart $SERVICE_NAME
        systemctl status $SERVICE_NAME --no-pager
        ;;
    status)
        echo "📊 SolTools Dex Bot Status:"
        systemctl status $SERVICE_NAME --no-pager
        echo ""
        echo "🌐 Health Check:"
        curl -s http://localhost:3000/health | jq . 2>/dev/null || curl -s http://localhost:3000/health
        ;;
    logs)
        echo "📋 Recent logs:"
        journalctl -u $SERVICE_NAME -n 50 --no-pager
        ;;
    logs-follow)
        echo "📋 Following logs (Ctrl+C to stop):"
        journalctl -u $SERVICE_NAME -f
        ;;
    dev)
        echo "🔧 Switching to development mode..."
        systemctl stop $SERVICE_NAME
        systemctl start $DEV_SERVICE_NAME
        systemctl status $DEV_SERVICE_NAME --no-pager
        ;;
    prod)
        echo "🚀 Switching to production mode..."
        systemctl stop $DEV_SERVICE_NAME 2>/dev/null
        systemctl start $SERVICE_NAME
        systemctl status $SERVICE_NAME --no-pager
        ;;
    enable)
        echo "✅ Enabling SolTools Dex Bot to start on boot..."
        systemctl enable $SERVICE_NAME
        ;;
    disable)
        echo "❌ Disabling SolTools Dex Bot from starting on boot..."
        systemctl disable $SERVICE_NAME
        ;;
    webhook)
        echo "🔗 Setting up webhook..."
        cd /root/Dexscreenerbot
        npm run setup-webhook
        ;;
    test)
        echo "🧪 Testing bot functionality..."
        echo "1. Health check:"
        curl -s http://localhost:3000/health | jq . 2>/dev/null || curl -s http://localhost:3000/health
        echo ""
        echo "2. HTTPS health check:"
        curl -s https://tzen.ai/health | jq . 2>/dev/null || curl -s https://tzen.ai/health
        echo ""
        echo "3. SSL certificate status:"
        certbot certificates 2>/dev/null | grep -A 5 "tzen.ai" || echo "No certificates found"
        echo ""
        echo "4. Webhook status:"
        curl -s "https://api.telegram.org/bot$(grep BOT_TOKEN .env | cut -d'=' -f2)/getWebhookInfo" | jq . 2>/dev/null || echo "Could not fetch webhook info"
        echo ""
        echo "5. Service status:"
        systemctl is-active $SERVICE_NAME
        ;;
    *)
        echo "🤖 SolTools Dex Bot Management Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  start       - Start the bot service"
        echo "  stop        - Stop the bot service"
        echo "  restart     - Restart the bot service"
        echo "  status      - Show service status and health"
        echo "  logs        - Show recent logs"
        echo "  logs-follow - Follow logs in real-time"
        echo "  dev         - Switch to development mode (with nodemon)"
        echo "  prod        - Switch to production mode"
        echo "  enable      - Enable service to start on boot"
        echo "  disable     - Disable service from starting on boot"
        echo "  webhook     - Set up Telegram webhook"
        echo "  test        - Test bot functionality"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 status"
        echo "  $0 logs"
        echo "  $0 test"
        ;;
esac
