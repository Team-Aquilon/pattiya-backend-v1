# ============================================================
# Terraform S3 Remote State Backend
# ============================================================
# This stores terraform.tfstate in S3 so CI/CD pipelines
# and team members share the same state (no conflicts).
#
# BOOTSTRAP: Create the S3 bucket ONCE manually first:
#   aws s3 mb s3://pattiya-terraform-state-ap-south-1 --region ap-south-1
#   aws s3api put-bucket-versioning \
#     --bucket pattiya-terraform-state-ap-south-1 \
#     --versioning-configuration Status=Enabled
# ============================================================

terraform {
  backend "s3" {
    bucket         = "pattiya-terraform-state-ap-south-1"
    key            = "pattiya-backend/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  required_version = ">= 1.6.0"
}
