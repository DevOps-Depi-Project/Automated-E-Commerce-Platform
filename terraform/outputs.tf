output "public_ip" {
  description = "Fixed public IP of the server."
  value       = aws_eip.app.public_ip
}

output "app_url" {
  description = "Storefront URL once Ansible has deployed the application."
  value       = "http://${aws_eip.app.public_ip}"
}

output "ssh_command" {
  description = "SSH into the server from the infra toolbox."
  value       = "ssh -i ~/.ssh/depi-ecommerce ubuntu@${aws_eip.app.public_ip}"
}

output "ssh_allowed_from" {
  description = "CIDR allowed to SSH (your IP when admin_cidr is empty)."
  value       = local.admin_cidr
}

output "instance_id" {
  value = aws_instance.app.id
}

output "ami" {
  description = "Ubuntu image used for the server."
  value       = data.aws_ami.ubuntu.name
}

output "deploy_mode" {
  description = "compose or k3s; decides which Ansible playbook (and Jenkins deploy) applies."
  value       = var.deploy_mode
}
