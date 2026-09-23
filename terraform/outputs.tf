output "elastic_ip" {
  description = "Static public IP of the EC2 instance — add this as EC2_HOST GitHub Secret"
  value       = aws_eip.app.public_ip
}

output "ecr_repository_url" {
  description = "ECR Docker image registry URL — used in GitHub Actions"
  value       = aws_ecr_repository.app.repository_url
}

output "ssh_command" {
  description = "Command to SSH into the EC2 instance"
  value       = "ssh -i pattiya-ec2-key.pem ubuntu@${aws_eip.app.public_ip}"
}
