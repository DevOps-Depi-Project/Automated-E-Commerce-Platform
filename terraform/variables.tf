variable "project" {
  description = "Name prefix and Project tag for every resource."
  type        = string
  default     = "depi-ecommerce"
}

variable "aws_region" {
  description = "AWS region. eu-central-1 (Frankfurt) is close to Egypt; us-east-1 is slightly cheaper."
  type        = string
  default     = "eu-central-1"
}

variable "instance_type" {
  description = "EC2 size. t3.small (2 GiB) runs the 9 containers comfortably."
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "Root disk size in GiB (OS + Docker images + database)."
  type        = number
  default     = 20
}

variable "vpc_cidr" {
  description = "Address range of the project VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Address range of the public subnet that holds the server."
  type        = string
  default     = "10.20.1.0/24"
}

variable "ssh_public_key_path" {
  description = "Public key installed on the server for SSH/Ansible. Create it with ssh-keygen (see README)."
  type        = string
  default     = "~/.ssh/depi-ecommerce.pub"
}

variable "admin_cidr" {
  description = "Who may SSH to the server, e.g. \"203.0.113.7/32\". Empty = your current public IP only."
  type        = string
  default     = ""

  validation {
    condition     = var.admin_cidr == "" || can(cidrhost(var.admin_cidr, 0))
    error_message = "admin_cidr must be empty or a CIDR block such as 203.0.113.7/32."
  }
}
