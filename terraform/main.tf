# One public EC2 server that runs the whole stack with Docker Compose.
# Ansible (../ansible) installs Docker on it and deploys the images from Docker Hub.
# Deliberately small for a course budget: no NAT gateway, load balancer or RDS yet;
# those come with the Kubernetes phase.

data "aws_availability_zones" "available" {
  state = "available"
}

# Latest Ubuntu 24.04 LTS (Canonical's official images).
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# The caller's public IP, used to allow SSH only from the person running Terraform.
data "http" "my_ip" {
  url = "https://checkip.amazonaws.com"
}

locals {
  admin_cidr = var.admin_cidr != "" ? var.admin_cidr : "${chomp(data.http.my_ip.response_body)}/32"
}

# ---------------------------------------------------------------- network

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.project}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------- firewall

resource "aws_security_group" "app" {
  name        = "${var.project}-app"
  description = "Web traffic from everyone, SSH only from the admin IP"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-app" }
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.app.id
  description       = "Storefront and API through Nginx"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.app.id
  description       = "SSH for Ansible, admin IP only"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = local.admin_cidr
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound (apt, Docker Hub)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------- server

resource "aws_key_pair" "deployer" {
  key_name   = "${var.project}-deployer"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = aws_key_pair.deployer.key_name

  root_block_device {
    volume_size           = var.root_volume_gb
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  # Require IMDSv2 tokens (protects instance credentials from SSRF-style attacks).
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  # "standard" avoids surprise charges: t3 defaults to "unlimited" CPU bursting, billed extra.
  credit_specification {
    cpu_credits = "standard"
  }

  tags = { Name = "${var.project}-app" }

  # A newer Ubuntu image must not silently replace (and wipe) the running server.
  lifecycle {
    ignore_changes = [ami]
  }
}

# Fixed public IP that survives stopping and starting the server.
resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id

  tags = { Name = "${var.project}-app" }

  depends_on = [aws_internet_gateway.main]
}

# ---------------------------------------------------------------- Ansible inventory

resource "local_file" "ansible_inventory" {
  filename        = "${path.module}/../ansible/inventory/hosts.ini"
  file_permission = "0644"
  content = templatefile("${path.module}/templates/hosts.ini.tftpl", {
    public_ip = aws_eip.app.public_ip
  })
}
