terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }

  # State is local (terraform/terraform.tfstate, ignored by Git) while one person deploys.
  # For a team, move it to an S3 backend with locking so everyone shares one state.
}

provider "aws" {
  region = var.aws_region

  # Tags on every resource make the project's resources and costs easy to find.
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Repo      = "DevOps-Depi-Project/Automated-E-Commerce-Platform"
    }
  }
}
