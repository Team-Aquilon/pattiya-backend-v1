#!/bin/bash
# ============================================================
# EC2 Bootstrap Script (user_data.sh)
# Runs ONCE on first boot of the EC2 instance.
# Installs: Docker, AWS CLI, Nginx, Certbot
# ============================================================
set -e

# Update system
apt-get update -y
apt-get upgrade -y

# Install Docker
apt-get install -y ca-certificates curl gnupg lsb-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io
usermod -aG docker ubuntu
systemctl enable docker
systemctl start docker

# Install AWS CLI v2
apt-get install -y unzip
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./install
rm -rf awscliv2.zip aws/

# Install Nginx
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

# Install Certbot (Let's Encrypt SSL)
apt-get install -y certbot python3-certbot-nginx

# Create deploy directory
mkdir -p /home/ubuntu/pattiya
chown ubuntu:ubuntu /home/ubuntu/pattiya

echo "Bootstrap complete!" > /home/ubuntu/bootstrap.done
