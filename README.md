# Automated E-Commerce Deployment Platform

An automated DevOps platform built around a containerized e-commerce application. The project demonstrates a seven-service microservices application and provides a foundation for automating builds, deployments, infrastructure management, monitoring, scaling, and recovery using modern DevOps tools.

> **Implementation status:** The current application includes seven business services and a Docker Compose environment. Kubernetes, Jenkins, Terraform, Ansible, AWS infrastructure, Prometheus, and Grafana are part of the broader project plan and should be marked complete only after they are implemented and tested. Payment currently uses a mock/simulation flow; no real card payments are processed.

---

## 1. Project Name

**Automated E-Commerce Deployment Platform**

## 2. Project Idea

The project aims to automate the deployment and operation of a multi-service e-commerce application while minimizing downtime and improving scalability, availability, and reliability.

The planned platform integrates containerization, continuous integration and continuous deployment (CI/CD), container orchestration, infrastructure as code, configuration management, monitoring, and automated rollback mechanisms.

### Main Objectives

- Automate application builds and deployments.
- Containerize application services using Docker.
- Orchestrate services using Kubernetes.
- Implement CI/CD pipelines using Jenkins.
- Provision AWS infrastructure using Terraform.
- Automate server configuration using Ansible.
- Monitor application health and performance using Prometheus and Grafana.
- Route incoming requests through Nginx.
- Implement health checks and automated rollback strategies.
- Improve application availability and scalability.

## 3. Project Architecture

### 3.1 E-Commerce Application

The current application is organized into seven business services:

1. **Frontend Service:** Provides the storefront interface and admin dashboard.
2. **Authentication Service:** Handles user authentication and JWT-based authorization.
3. **Product Service:** Manages the product catalog and product information.
4. **Cart Service:** Manages shopping cart items and quantities.
5. **Order Service:** Coordinates checkout and manages order processing.
6. **Inventory Service:** Manages stock quantities and temporary stock reservations.
7. **Payment Service:** Simulates the payment workflow for academic testing.

The application uses PostgreSQL as its database server, with separate schemas for service-level data ownership.

### 3.2 DevOps and Infrastructure Components

The broader proposed deployment platform includes:

1. **Docker:** Packages application services into containers.
2. **Jenkins:** Automates testing, image building, and deployment.
3. **Kubernetes:** Manages containers, service discovery, health checks, and scaling.
4. **Ansible:** Automates server preparation and configuration.
5. **Terraform:** Provisions cloud infrastructure on AWS.
6. **Nginx:** Serves the frontend and routes incoming requests as configured.
7. **Prometheus:** Collects metrics from the application and infrastructure.
8. **Grafana:** Visualizes metrics through monitoring dashboards.
9. **Amazon EC2:** Provides compute infrastructure.
10. **Amazon RDS:** Provides a managed relational database, if selected for cloud deployment.
11. **Amazon S3:** Stores static assets and other application files, if required.
12. **AWS Elastic Load Balancing:** Distributes incoming traffic across application instances.

These are planned platform components; their presence in this description does not by itself mean they have already been deployed.

### 3.3 Application Architecture Diagram

```text
                         ┌──────────────────────┐
                         │   Frontend (Nginx)   │
                         │       Port 3000      │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
       ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
       │    Auth     │       │   Product   │       │    Cart     │
       │    :3003    │       │    :3001    │       │    :3006    │
       └─────────────┘       └─────────────┘       └─────────────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    │
                            ┌───────▼───────┐
                            │     Order     │
                            │     :3002     │
                            └──────┬───┬────┘
                                   │   │
                         ┌─────────▼┐ ┌▼──────────┐
                         │ Inventory│ │  Payment  │
                         │   :3004  │ │   :3005   │
                         └──────────┘ └───────────┘

                       ┌─────────────────────────┐
                       │ PostgreSQL (internal)   │
                       │ Separate schema/service │
                       │        :5432            │
                       └─────────────────────────┘
```

This is a logical application overview. Internal service-to-service communication takes place over the Docker Compose network. Not every service port needs to be exposed publicly.

### 3.4 Services and Ports

| Service | Port | Responsibility |
|---|---:|---|
| Frontend | 3000 | Storefront and admin interface |
| Product Service | 3001 | Product catalog and product information |
| Order Service | 3002 | Checkout orchestration and order lifecycle |
| Authentication Service | 3003 | Authentication and JWT issuance |
| Inventory Service | 3004 | Stock quantities and reservations |
| Payment Service | 3005 | Mock/simulated payment processing |
| Cart Service | 3006 | Shopping cart items and quantities |
| PostgreSQL | 5432 | Persistent relational database; internal service |

## 4. Tools and Technologies

| Technology | Purpose | Project status |
|---|---|---|
| Git & GitHub | Version control and source code management | In use |
| Docker | Application containerization | In use |
| Docker Compose | Local multi-service environment | In use |
| Node.js / Express | Backend services | In use |
| HTML, CSS, JavaScript | Frontend application | In use |
| Nginx | Frontend web server and request routing | In use |
| PostgreSQL | Relational database | In use |
| JWT | Authentication and authorization | In use |
| Mock Payment | Academic payment simulation | In use |
| Jenkins | CI/CD automation | Planned |
| Kubernetes | Container orchestration and scaling | Planned |
| Ansible | Configuration management | Planned |
| Terraform | Infrastructure provisioning | Planned |
| AWS EC2 | Compute infrastructure | Planned |
| AWS RDS | Managed relational database | Planned |
| AWS S3 | Object and asset storage | Planned / if required |
| AWS ELB | Load balancing | Planned |
| Prometheus | Metrics collection and alerting | Planned |
| Grafana | Monitoring dashboards | Planned |

## 5. Team Members

| No. | Team Member |
|---:|---|
| 1 | Mosab Mohamed Sayed Ahmed |
| 2 | Fares Ahmed Fathy Ahmed |
| 3 | Ahmed Hossam Mohamed Zaki |
| 4 | Mohamed Ahmed Mahdy Abdelaziz |
| 5 | Mohammed Omar Abdelwahab Hamdallah |
| 6 | Abdulrahman Mustafa Hamed Mustafa |

### Roles and Responsibilities

The following responsibility areas are proposed for the team. Individual assignments can be added once confirmed.

- **DevOps Engineer / Team Leader:** Coordinate project development, maintain the GitHub repository, integrate project components, and review documentation and progress.
- **CI/CD and Docker Engineer:** Develop Dockerfiles and container configurations, configure Jenkins pipelines, and implement automated testing and image publishing.
- **Kubernetes Engineer:** Configure Kubernetes workloads and networking, implement health checks and autoscaling, and test rolling updates and rollback strategies.
- **AWS and Infrastructure Engineer:** Create Terraform configurations, provision AWS resources, configure infrastructure security and networking, and develop Ansible playbooks.
- **Monitoring and Reliability Engineer:** Configure Prometheus and Grafana, create dashboards and alerts, test service availability and failure recovery, and document reliability metrics.

For a six-member team, responsibilities may be shared or combined. The names above are the supplied team list; no individual role assignment is implied.

## 6. Work Plan

### Phase 1: Planning and Design

- Define project requirements.
- Design the system architecture.
- Create the GitHub repository.
- Define the services and deployment workflow.

### Phase 2: Application and Containerization

- Develop the application services.
- Create Dockerfiles for each service.
- Configure service networking and environment variables.
- Test the containers locally using Docker Compose.

### Phase 3: CI/CD Pipeline

- Configure Jenkins.
- Integrate Jenkins with GitHub.
- Automate testing and Docker image builds.
- Push images to a container registry.
- Automate deployment and rollback procedures.

### Phase 4: Kubernetes Deployment

- Create Kubernetes Deployments and Services.
- Configure ConfigMaps, Secrets, and health probes.
- Configure Horizontal Pod Autoscaling.
- Implement rolling updates and rollback procedures.

### Phase 5: Infrastructure Provisioning

- Write Terraform configurations for AWS infrastructure.
- Provision EC2 instances, RDS, S3, and a load balancer where required.
- Use Ansible to configure servers and install required dependencies.
- Secure network access and application credentials.

### Phase 6: Monitoring and Reliability

- Configure Prometheus metrics collection.
- Build Grafana dashboards.
- Configure service health monitoring and alerts.
- Test application failures and recovery procedures.

### Phase 7: Testing and Documentation

- Test CI/CD automation.
- Test scaling under increased traffic.
- Validate rollback procedures.
- Document the architecture and setup instructions.
- Prepare the final demonstration.

## 7. Key Performance Indicators (KPIs)

The following are proposed project targets, not measured results. Actual results should be measured and documented during testing.

| KPI | Proposed Target |
|---|---|
| Successful automated deployments | At least 95% |
| Application availability during testing | At least 99% |
| CI/CD execution time | Less than 10 minutes for a typical deployment |
| Recovery Time Objective (RTO) | Less than 5 minutes in a tested failure scenario |
| Rollback execution time | Less than 2 minutes in a tested scenario |
| Service health monitoring | All critical services monitored |
| Autoscaling | Successfully scales when configured thresholds are exceeded |
| Infrastructure reproducibility | Successful provisioning from Terraform configurations |
| Deployment automation | No routine manual deployment steps after pipeline configuration |

## 8. Instructor

**Instructor Name:** Ahmed Gamil

## 9. How the Checkout Flow Works

1. A customer browses the product catalog and adds products to the cart.
2. The Cart Service stores product IDs and quantities. It is not the source of truth for product prices or available stock.
3. At checkout, the Order Service validates current product information and pricing with the Product Service.
4. The Order Service requests a temporary stock reservation from the Inventory Service.
5. The Order Service calls the Payment Service to simulate payment.
6. If payment succeeds, the reservation is committed and the order is completed.
7. If payment fails, the reservation is released.
8. Reservations expire after a configurable period so abandoned checkouts do not hold stock indefinitely.

The checkout flow uses an idempotency key to help prevent duplicate order creation when a checkout request is retried. Payment is simulated and must not be used to collect or process real payment-card information.

## 10. Admin Dashboard

The frontend includes an admin area:

- Storefront: `http://localhost:3000`
- Admin dashboard: `http://localhost:3000/admin`

Admin operations use authenticated admin authorization. The dashboard and related service endpoints are intended for administrative tasks such as:

- Viewing products, including inactive products.
- Adding, editing, and deactivating products.
- Viewing inventory quantities and adjusting stock.
- Reviewing orders and order details.

Use an account configured with the admin role. Do not put admin credentials or JWT secrets in source control.

## 11. Running the Application Locally

### Prerequisites

- Git
- Docker Desktop with the WSL 2 backend on Windows, or Docker Engine on Linux
- Docker Compose plugin

### 11.1 Clone the Repository

```bash
git clone https://github.com/DevOps-Depi-Project/Automated-E-Commerce-Platform.git
cd Automated-E-Commerce-Platform
```

### 11.2 Configure Environment Variables

Review the `.env.example` files and `docker-compose.yml`. Create the required local `.env` files from the corresponding examples and configure values for your environment.

Configuration categories include:

- PostgreSQL connection settings.
- Per-service database/schema settings.
- JWT signing and verification secret.
- Admin bootstrap credentials.
- Internal service URLs.
- Payment simulation settings.
- Reservation expiry settings.

Use secure, unique values for secrets. Never commit `.env` files, passwords, tokens, or private keys.

### 11.3 Start the Application

```bash
docker compose up --build -d
```

### 11.4 Check the Containers

```bash
docker compose ps
```

Wait until services with health checks report healthy. The frontend may not display a health status if its Compose service does not define a health check.

### 11.5 Open the Application

- Storefront: [http://localhost:3000](http://localhost:3000)
- Admin dashboard: [http://localhost:3000/admin](http://localhost:3000/admin)

## 12. Useful Docker Commands

Start or rebuild the stack:

```bash
docker compose up --build -d
```

View running services:

```bash
docker compose ps
```

Follow logs for all services:

```bash
docker compose logs -f
```

Follow logs for one service:

```bash
docker compose logs -f order-service
```

Stop the stack without deleting persistent database volumes:

```bash
docker compose down
```

Stop the stack and remove named volumes (this deletes local database data):

```bash
docker compose down -v
```

Only use `docker compose down -v` when you intentionally want to reset the local database.

## 13. API and Health Checks

The backend services expose HTTP APIs on their respective container ports. Exact routes and request/response contracts are defined in each service's source code and in the API documentation under `docs/`.

Where a health endpoint is available, it can be used to check service readiness. For example:

```bash
curl http://localhost:3001/health
```

If a service port is not published to the host in `docker-compose.yml`, run the request from another container on the Compose network or inspect the service configuration.

## 14. Database Design

The project uses one PostgreSQL server with separate schemas for service-level data ownership. This keeps the database infrastructure simple for the demo while maintaining logical separation between services.

- Product Service owns product catalog data and pricing.
- Inventory Service owns stock quantities and reservations.
- Cart Service owns cart contents.
- Order Service owns orders and order snapshots.
- Authentication Service owns authentication-related data.
- Payment Service owns simulated payment records.

Services should access their own data through their own service logic rather than directly modifying another service's schema.

## 15. Project Files and Repository Structure

The repository is organized by service and supporting documentation. The exact structure may evolve as implementation progresses.

```text
Automated-E-Commerce-Platform/
├── frontend/
├── auth-service/
├── product-service/
├── order-service/
├── cart-service/
├── inventory-service/
├── payment-service/
├── docs/
│   ├── architecture/
│   ├── api-contracts/
│   ├── implementation-roadmap.md
│   └── original-project-proposal.md
├── docker-compose.yml
├── .gitignore
└── README.md
```

The proposed future DevOps structure may include:

```text
jenkins/
│   └── Jenkinsfile
kubernetes/
│   ├── deployments/
│   ├── services/
│   ├── configmaps/
│   └── hpa.yaml
ansible/
│   ├── inventory/
│   └── playbooks/
terraform/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── modules/
monitoring/
│   ├── prometheus.yml
│   └── grafana/
tests/
```

These future directories should be added as the corresponding components are implemented.

### Architecture Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Service responsibilities](docs/architecture/services-responsibilities.md)
- [Database design](docs/architecture/database-design.md)
- [Checkout workflow](docs/architecture/checkout-workflow.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [API contracts](docs/api-contracts/)
- [Implementation roadmap](docs/implementation-roadmap.md)

## 16. CI/CD and Deployment Roadmap

The project proposal includes a broader DevOps direction:

1. Configure a Jenkins pipeline connected to GitHub.
2. Run automated validation and tests.
3. Build and tag Docker images for the application services.
4. Push images to a container registry.
5. Deploy the application to Kubernetes.
6. Use readiness/liveness probes and rolling updates.
7. Validate rollback procedures.
8. Provision selected cloud infrastructure using Terraform.
9. Configure servers using Ansible.
10. Monitor application and infrastructure metrics using Prometheus and Grafana.

These steps are roadmap items until the related pipeline, manifests, infrastructure code, and monitoring configuration are present and tested in the repository.

## 17. Security Considerations

- Never commit AWS credentials, API keys, passwords, or production secrets.
- Use environment variables and an appropriate secrets-management mechanism.
- Restrict access to databases and administrative services.
- Use HTTPS for externally accessible application endpoints.
- Use a payment sandbox or mock payment gateway for academic testing.
- Apply least-privilege IAM policies and appropriate network security rules.
- Keep PostgreSQL and internal-only services off the public internet.
- Use secure JWT secrets and protect admin accounts.
- Do not enter real payment-card details into the mock payment flow.

This is a learning and demonstration project, not a production-hardened commerce platform. A production deployment requires additional security review, backups, rate limiting, monitoring, and a real payment-provider integration.

## 18. Expected Outcomes

The expected project outcomes are:

- A containerized e-commerce application.
- An automated CI/CD pipeline.
- A Kubernetes-based deployment with autoscaling.
- Reproducible AWS infrastructure using Terraform.
- Automated server configuration using Ansible.
- Centralized monitoring dashboards using Prometheus and Grafana.
- Reverse proxy routing using Nginx.
- Tested deployment rollback and recovery procedures.
- Complete technical documentation and a GitHub repository.

The outcomes should be marked as completed only after implementation and demonstration.

## 19. Conclusion

The Automated E-Commerce Deployment Platform demonstrates how DevOps tools and practices can automate the software delivery lifecycle, improve application reliability, simplify infrastructure management, and support scalable deployments for modern e-commerce systems. The seven-service e-commerce application provides the application foundation, while the planned DevOps phases extend it into an automated deployment and operations platform.
