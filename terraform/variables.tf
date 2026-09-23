variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "ap-south-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t2.micro"
}

variable "key_pair_name" {
  description = "Name of the AWS Key Pair for SSH access"
  type        = string
  default     = "pattiya-ec2-key"
}

variable "app_name" {
  description = "Application name prefix for resource naming"
  type        = string
  default     = "pattiya-backend"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}
