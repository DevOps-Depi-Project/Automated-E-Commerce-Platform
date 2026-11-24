# Automated E-Commerce Deployment Platform

An automated DevOps platform built around a containerized e-commerce application. The project demonstrates an eight-service microservices application (web, database, payment and search included) and provides a foundation for automating builds, deployments, infrastructure management, monitoring, scaling, and recovery using modern DevOps tools.

> **Implementation status:** The current application includes eight business services, an Nginx reverse proxy, and a Docker Compose environment. Kubernetes, Jenkins, Terraform, Ansible, AWS infrastructure, Prometheus, and Grafana are part of the broader project plan and should be marked complete only after they are implemented and tested. Payment currently uses a mock/simulation flow; no real card payments are processed.

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

The current application is organized into eight business services:

1. **Frontend Service:** Provides the storefront interface and admin dashboard. Its Nginx server is also the reverse proxy for all APIs.
2. **Authentication Service:** Handles customer registration, login, and JWT-based authorization.
3. **Product Service:** Manages the product catalog and product information (source of truth for prices).
4. **Cart Service:** Manages shopping cart items and quantities.
5. **Order Service:** Coordinates checkout and manages order processing.
6. **Inventory Service:** Manages stock quantities and temporary stock reservations.
7. **Payment Service:** Simulates the payment workflow for academic testing (internal only).
8. **Search Service:** Product search with relevance ranking, prefix matching, typo tolerance, filters, and category facets. It keeps its own search index that is synchronised from Product Service.

The application uses PostgreSQL as its database server, with separate schemas for service-level data ownership.

### 3.2 DevOps and Infrastructure Components

The broader proposed deployment platform includes:

1. **Docker:** Packages application services into containers.
2. **Jenkins:** Automates testing, image building, and deployment.
3. **Kubernetes:** Manages containers, service discovery, health checks, and scaling.
4. **Ansible:** Automates server preparation and configuration.
5. **Terraform:** Provisions cloud infrastructure on AWS.
6. **Nginx:** Serves the frontend and acts as the reverse proxy that routes `/api/...` requests to the services (implemented).
7. **Prometheus:** Collects metrics from the application and infrastructure.
8. **Grafana:** Visualizes metrics through monitoring dashboards.
9. **Amazon EC2:** Provides compute infrastructure.
10. **Amazon RDS:** Provides a managed relational database, if selected for cloud deployment.
11. **Amazon S3:** Stores static assets and other application files, if required.
12. **AWS Elastic Load Balancing:** Distributes incoming traffic across application instances.

Apart from Docker and Nginx, these are planned platform components; their presence in this description does not by itself mean they have already been deployed.

### 3.3 Application Architecture Diagram

```text
                          Browser
                             │  http://localhost:3000  (the only published port)
                             ▼
   ┌────────────────────────────────────────────────────────┐
   │ Frontend - Nginx                                       │
   │   /              -> storefront and admin dashboard     │
   │   /api/<service>/ -> reverse proxy to the service      │
   └──┬─────────┬─────────┬─────────┬──────────┬─────────┬──┘
      ▼         ▼         ▼         ▼          ▼         ▼
    Auth     Product    Cart      Order    Inventory  Search
    :3003    :3001      :3006     :3002    :3004      :3007

   Service-to-service calls (Docker Compose network):
     Cart    ──> Product     current name and price of cart items
     Order   ──> Product     trusted prices at checkout
     Order   ──> Inventory   reserve / commit / release stock
     Order   ──> Payment     mock payment (:3005, internal only)
     Search  ──> Product     copies the active catalog every 30 s

   PostgreSQL :5432 (internal) - one schema per service:
     auth, products, carts, orders, inventory, payments, search
```

Authentication is called only by the browser; the other services verify its JWTs locally with the shared secret.

### 3.4 Services and Ports

Only the frontend port is published to the host. Every API is reached through Nginx at `http://localhost:3000/api/<service>/...`; the other ports exist only inside the Compose network.

| Service | Internal port | Gateway path | Responsibility |
|---|---:|---|---|
| Frontend (Nginx) | 80 → host **3000** | `/` | Storefront, admin interface, reverse proxy |
| Product Service | 3001 | `/api/product/` | Product catalog and product information |
| Order Service | 3002 | `/api/order/` | Checkout orchestration and order lifecycle |
| Authentication Service | 3003 | `/api/auth/` | Registration, login, and JWT issuance |
| Inventory Service | 3004 | `/api/inventory/` | Stock quantities and reservations |
| Payment Service | 3005 | not routed | Mock/simulated payment processing; called only by Order |
| Cart Service | 3006 | `/api/cart/` | Shopping cart items and quantities |
| Search Service | 3007 | `/api/search/` | Product search, filters, and category facets |
| PostgreSQL | 5432 | not routed | Persistent relational database |

Nginx removes the `/api/<service>` prefix before forwarding, so `GET /api/search/search?q=laptop` reaches Search Service as `GET /search?q=laptop`. If a service is down, Nginx answers with a JSON `503 SERVICE_UNAVAILABLE` error.

## 4. Tools and Technologies

| Technology | Purpose | Project status |
|---|---|---|
| Git & GitHub | Version control and source code management | In use |
| Docker | Application containerization | In use |
| Docker Compose | Local multi-service environment | In use |
| Node.js / Express | Backend services | In use |
| HTML, CSS, JavaScript | Frontend application | In use |
| Nginx | Frontend web server and reverse proxy (`/api/...` routing) | In use |
| PostgreSQL | Relational database | In use |
| JWT | Authentication and authorization | In use |
| Mock Payment | Academic payment simulation | In use |
| Jenkins | CI/CD automation | Planned |
| Kubernetes | Container orchestration and scaling | In use (k3s on AWS; manifests in `kubernetes/`) |
| Ansible | Configuration management | Planned |
| Terraform | Infrastructure provisioning | Planned |
| AWS EC2 | Compute infrastructure | Planned |
| AWS RDS | Managed relational database | Planned |
| AWS S3 | Object and asset storage | Planned / if required |
| AWS ELB | Load balancing | Planned |
| Prometheus | Metrics collection and alerting | In use (local, profile `monitoring`) |
| Grafana | Monitoring dashboards | In use (local, profile `monitoring`) |

### 4.1 Course Requirements Checklist

The project brief asks for a multi-service platform (**web, database, payment, search**) and nine deliverables:

| Requirement | Status |
|---|---|
| Web, database, payment and search components | Done: Frontend, PostgreSQL, Payment Service (mock), Search Service |
| 1. Dockerized e-commerce microservices | Done: eight services plus PostgreSQL in Docker Compose |
| 2. CI/CD pipelines for updates | Done: Jenkins tests, builds and publishes images, then deploys `main` to AWS with Ansible (`Jenkinsfile`) |
| 3. Kubernetes deployment with auto-scaling | Done: k3s on AWS (`ansible/k3s.yml`), probes, zero-downtime rolling updates, HPA tested under load (1 → 4 pods) |
| 4. Ansible scripts for server/configuration setup | Done: `ansible/` installs Docker and deploys the stack on EC2 |
| 5. Prometheus dashboards for service monitoring | Done: Prometheus scrapes every service, Grafana dashboard and alert rules provisioned as code (`monitoring/`) |
| 6. Nginx reverse proxy for routing | Done: `frontend/nginx.conf` routes `/api/<service>/` |
| 7. Terraform scripts for AWS EC2, RDS, S3, ELB | In progress: `terraform/` creates the VPC, security group and EC2 server; RDS, S3 and ELB come with the Kubernetes phase |
| 8. Automated rollback strategies | Done: Ansible rolls back automatically on failed deploys (Compose and k3s); Kubernetes rolling updates and `rollout undo` |
| 9. Git repository for code and scripts | Done |

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

Demo limitations: the mock payment accepts **USD only** (an order in another currency fails with `PAYMENT_REJECTED` and its stock is released immediately), and under Docker Compose (`NODE_ENV=production`) payment simulation is disabled, so payments always use `PAYMENT_DEFAULT_RESULT`.

### 9.1 How Product Search Works

The storefront search box, category buttons, price filter, and sort menu all call Search Service (`/api/search/search`).

- **Own data:** Search Service keeps a read-only copy of the active catalog in its own `search` schema. Product Service stays the source of truth and is never modified by Search.
- **Synchronisation:** every `SEARCH_SYNC_INTERVAL_SECONDS` (default 30 s) Search reads Product Service's public `GET /products` API, adds or updates changed products, and removes deactivated ones. A product added or edited in the admin dashboard therefore appears in search within about 30 seconds (eventual consistency).
- **Matching:** PostgreSQL full-text search with prefix matching (`lap` finds *Laptop*) and stemming (`headphone` finds *Headphones*), plus `pg_trgm` trigram similarity for typos (`labtop` finds *Laptop*). Results are ranked by relevance; name matches weigh more than category and description matches.
- **Filters:** `category`, `minPrice`, `maxPrice`, `sort` (`relevance`, `name-asc`, `name-desc`, `price-asc`, `price-desc`) and pagination. `GET /search/categories` returns the categories with product counts, used to build the category buttons.
- **Resilience:** if Product Service is down, Search keeps answering from its last snapshot. If Search Service is down, the storefront falls back to loading the catalog from Product Service and filtering it in the browser.
- **Scaling:** Search is stateless apart from its index, so it can run several replicas; a PostgreSQL advisory lock makes sure only one replica applies a sync at a time.

## 10. Admin Dashboard

The frontend includes an admin area:

- Storefront: `http://localhost:3000`
- Admin dashboard: `http://localhost:3000/admin`

Admin operations use authenticated admin authorization. The dashboard and related service endpoints are intended for administrative tasks such as:

- Viewing products, including inactive products.
- Adding, editing, and deactivating products.
- Viewing inventory quantities and adjusting stock.
- Reviewing orders and order details.

Customers can create their own accounts from the storefront, but admin accounts cannot be created from the UI. The admin account is created at startup from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` (see 11.2); it is created only if that email does not exist yet, and an existing customer account is never promoted. Do not put admin credentials or JWT secrets in source control.

A newly added product has no stock until a quantity is added in the Inventory section; until then the storefront shows it as out of stock.

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

Docker Compose reads only the root `.env` file. It is ignored by Git, so it does **not** come with a clone or a copy of the repository (for example when moving the project from WSL to Windows). Create it before the first run:

```bash
cp .env.example .env            # Linux / WSL / Git Bash
Copy-Item .env.example .env     # Windows PowerShell
```

Then replace `POSTGRES_PASSWORD`, `JWT_SECRET` (32+ characters) and `INTERNAL_SERVICE_TOKEN` (32+ characters). Without them `docker compose up` stops with `Set ... in .env`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (8–72 characters) if you want an admin account for `/admin`. Avoid `$` in values, because Compose treats it as variable interpolation.

The per-service `.env.example` files are only for running a single service outside Docker.

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

Wait until all nine containers (eight services plus PostgreSQL) report `(healthy)`; this usually takes about a minute. On a slow machine `docker compose up` may stop waiting before the last containers start (they stay `Created`); run `docker compose up -d` again to start them.

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

### 12.1 Docker Hub Images

Every service image is named `<DOCKERHUB_USER>/ecommerce-<service>:<IMAGE_TAG>`, for example `mosab2004/ecommerce-search-service:6f286d9`. Set `DOCKERHUB_USER` and `IMAGE_TAG` in `.env`. Each release is pushed twice: with the short Git commit ID (an immutable version that rollbacks can return to) and as `latest`.

Run a published version without building anything (this is how servers deploy):

```bash
IMAGE_TAG=6f286d9 docker compose pull
IMAGE_TAG=6f286d9 docker compose up -d --no-build
```

Build and publish a new version (requires `docker login` with push access to the account):

```bash
IMAGE_TAG=$(git rev-parse --short HEAD) docker compose build
IMAGE_TAG=$(git rev-parse --short HEAD) docker compose push
```

The images contain no secrets: `.env` is excluded by each service's `.dockerignore`, and secrets are passed only as environment variables at runtime. Docker Hub repositories are public by default.

## 13. API and Health Checks

All public APIs are reached through the Nginx reverse proxy on port 3000. Exact routes and request/response contracts are defined in each service's source code and in the API documentation under `docs/api-contracts/`.

Every service has a `/health` endpoint:

```bash
curl http://localhost:3000/api/product/health
curl http://localhost:3000/api/search/health      # also shows the search index sync status
```

Search examples:

```bash
curl "http://localhost:3000/api/search/search?q=laptop"
curl "http://localhost:3000/api/search/search?category=electronics&maxPrice=700&sort=price-desc"
curl "http://localhost:3000/api/search/search/categories"
```

Backend ports are not published to the host. To call a service directly (for example Payment, which is not routed), run the request inside the Compose network:

```bash
docker compose exec order-service wget -qO- http://payment-service:3005/health
```

### 13.1 Prometheus Metrics

Every Node.js service exposes `GET /metrics` in Prometheus format (library `prom-client`, shared file `<service>/metrics.js`). The endpoint is internal: Nginx returns `404` for `/api/<service>/metrics`, and Prometheus will scrape `<service>:<port>/metrics` inside the network.

| Metric | Meaning |
|---|---|
| `http_requests_total{method,route,status_code}` | Requests per route pattern (for example `/products/:id`) and status |
| `http_request_duration_seconds{method,route,status_code}` | Latency histogram (for p95/p99 and SLOs) |
| `process_*`, `nodejs_*` | CPU, memory, event loop lag, GC (default Node.js metrics) |
| `orders_checkout_requests_total{outcome}` | Checkouts by outcome: `CONFIRMED`, `PENDING`, `REPLAYED`, or an error code such as `INSUFFICIENT_STOCK` |
| `orders_confirmed_total{currency}`, `orders_confirmed_amount_total{currency}` | Confirmed orders and revenue |
| `search_queries_total{type,result}` | Searches (`text` or `browse`) and whether they matched anything |
| `search_index_products`, `search_index_last_success_timestamp_seconds`, `search_sync_runs_total{result}` | Search index size and sync health |

Every series has a `service` label. To look at the raw output locally:

```bash
docker compose exec search-service wget -qO- http://127.0.0.1:3007/metrics | head -40
```

### 13.2 Monitoring with Prometheus and Grafana

Prometheus and Grafana are optional services in `docker-compose.yml` (Compose profile `monitoring`), so they use memory only when needed:

```bash
docker compose --profile monitoring up -d --wait
```

- **Prometheus:** [http://localhost:9090](http://localhost:9090) scrapes all seven services every 15 seconds (`monitoring/prometheus/prometheus.yml`) and keeps 7 days of data. Alerts: [http://localhost:9090/alerts](http://localhost:9090/alerts).
- **Grafana:** [http://localhost:3100](http://localhost:3100) opens the **E-Commerce Overview** dashboard directly. Viewing needs no login; editing uses `admin` / `GRAFANA_ADMIN_PASSWORD` from `.env` (default `admin`).

Everything is provisioned as code, so nothing is configured by hand:

```text
monitoring/prometheus/prometheus.yml        scrape targets
monitoring/prometheus/alerts.yml            alert rules
monitoring/grafana/provisioning/            Prometheus data source + dashboard loader
monitoring/grafana/dashboards/*.json        dashboards
```

The dashboard has four rows: **Health** (each service UP/DOWN), **Traffic** (requests per second, 5xx error rate, p95 latency, status codes; health checks excluded), **Business** (confirmed orders, revenue, checkouts by outcome, searches, search index size and age) and **Resources** (memory, CPU, event loop lag per service).

| Alert | Fires when |
|---|---|
| `ServiceDown` | A service cannot be scraped for 1 minute |
| `HighErrorRate` | More than 5% of a service's requests return 5xx for 5 minutes |
| `SlowResponses` | p95 latency of a service is above 1 s for 5 minutes |
| `CheckoutsFailing` | More than half of checkouts end with an error for 10 minutes |
| `SearchIndexStale` | The search index has not synced for more than 5 minutes |

Tested by stopping `search-service`: `ServiceDown` went to *pending* after about 30 s, to *firing* after 1 minute, and cleared when the service was started again. Alerts are shown in Prometheus and Grafana; sending them by e-mail or chat (Alertmanager) is a possible next step.

## 14. Testing

Tests use Node.js's built-in test runner (`node --test`), so no extra test libraries are needed. Node.js 22.9 or newer is required on the machine that runs them.

**Unit tests** (one `test/server.test.js` per service) start each service's Express app on a random local port without a database. They cover input validation, authentication and authorization, idempotency hashing, money rounding, search query safety, the database-down path (`503`), and `/metrics`.

```bash
npm run test:unit                      # all services (runs "npm ci" first where node_modules is missing)
npm run test:unit -- search-service    # one service
cd search-service && npm test          # same, from inside a service
```

**End-to-end smoke test** (`tests/e2e/smoke.test.js`) runs against the running stack through Nginx. It needs `ADMIN_EMAIL` and `ADMIN_PASSWORD` (read from `.env`). It creates its own product and stock as the admin, registers a customer, waits for the product to appear in search, adds it to the cart, checks out, verifies the stock change and idempotent retry, checks that overselling is refused and internal endpoints are hidden, and finally deactivates the test product.

```bash
docker compose up -d --wait
npm run test:e2e
```

Both commands exit with a non-zero code on failure, which is what the CI pipeline uses to stop a bad build. Test files are excluded from the Docker images (`.dockerignore`).

## 15. Database Design

The project uses one PostgreSQL server with separate schemas for service-level data ownership. This keeps the database infrastructure simple for the demo while maintaining logical separation between services.

- Product Service owns product catalog data and pricing.
- Inventory Service owns stock quantities and reservations.
- Cart Service owns cart contents.
- Order Service owns orders and order snapshots.
- Authentication Service owns authentication-related data.
- Payment Service owns simulated payment records.
- Search Service owns the `search` schema: a read-only search index copied from Product Service's public API.

Services should access their own data through their own service logic rather than directly modifying another service's schema.

## 16. Project Files and Repository Structure

The repository is organized by service and supporting documentation. The exact structure may evolve as implementation progresses.

```text
Automated-E-Commerce-Platform/
├── frontend/                 # index.html + nginx.conf (reverse proxy)
├── authentication-service/
├── product-service/
├── order-service/
├── cart-service/
├── inventory-service/
├── payment-service/
├── search-service/
├── docs/
│   ├── architecture/
│   ├── api-contracts/
│   ├── implementation-roadmap.md
│   └── original-project-proposal.md
├── kubernetes/               # Kustomize manifests (base + overlays), HPA, metrics-server addon
├── monitoring/               # Prometheus config + alerts, Grafana provisioning + dashboards
├── tests/
│   ├── e2e/smoke.test.js     # end-to-end test against the running stack
│   └── run-unit-tests.js     # runs every service's unit tests
├── docker-compose.yml
├── package.json              # npm run test:unit / test:e2e
├── .gitignore
└── README.md
```

Each service folder contains `server.js`, `metrics.js`, `migrate.js` with `migrations/`, `test/`, `Dockerfile`, `.dockerignore`, `package.json` with `package-lock.json` (images are built with `npm ci`), and `.env.example`.

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

## 17. CI/CD with Jenkins

The pipeline is defined in the root [`Jenkinsfile`](Jenkinsfile) and runs on a local Jenkins that is itself configured as code in [`jenkins/`](jenkins/).

```text
every branch:  Prepare -> Unit tests -> Build images -> End-to-end test
main only:                                                 -> Push to Docker Hub -> Deploy to AWS
```

- **Prepare:** the image tag is the short commit ID; `tests/write-ci-env.js` generates random throwaway secrets for the test stack.
- **Unit tests:** `npm run test:unit` for all services.
- **Build images:** `docker compose build`, two images at a time.
- **End-to-end test:** starts the stack as a separate Compose project (`ecommerce-ci`, port 3080, its own database volume), runs `npm run test:e2e`, prints container logs if it fails, and always deletes the stack and its volume.
- **Push to Docker Hub:** only on `main`, and only if every earlier stage passed. Each image is pushed as `<commit>` (immutable, used for rollback) and `latest`.
- **Deploy to AWS:** only on `main`, and only while a server exists (Terraform writes `ansible/inventory/hosts.ini` on `apply` and removes it on `destroy`; Jenkins sees it read-only). Jenkins runs `ansible/site.yml` with the new tag, which rolls back automatically if the new version fails, and then checks the site from outside. Without a server the stage is skipped, not failed.

### 17.1 Running Jenkins Locally

Jenkins runs in Docker and drives the host's Docker engine through the mounted Docker socket. Plugins, the admin user, the Docker Hub credential and the `ecommerce-platform` multibranch job are created automatically from [`jenkins/casc/jenkins.yaml`](jenkins/casc/jenkins.yaml) (Configuration as Code); there is no setup wizard.

1. Create a Docker Hub personal access token with **Read & Write** scope (hub.docker.com → Account settings → Personal access tokens).
2. Create `jenkins/.env` from [`jenkins/.env.example`](jenkins/.env.example) and fill in the Jenkins admin password, Docker Hub user and token. The file is ignored by Git.
3. Start Jenkins (stop the application stack first if memory is limited; Jenkins needs about 1 GB):

   ```bash
   cd jenkins
   docker compose up -d --build
   ```

4. Open [http://localhost:8090](http://localhost:8090) (or the `JENKINS_PORT` you set) and sign in with `JENKINS_ADMIN_USER` / `JENKINS_ADMIN_PASSWORD`.

The job scans the GitHub repository every 2 minutes and builds any branch that has new commits (GitHub cannot send webhooks to a laptop). To build immediately, open the job and click **Scan Multibranch Pipeline Now**, or **Build Now** on a branch.

The admin password, the Docker Hub token and the server SSH key (`~/.ssh/depi-ecommerce`, credential `deploy-ssh`) are passed as Docker secrets (files in `/run/secrets`), not environment variables, so builds cannot print them. Jenkins reads the SSH key through group 0, so make it group-readable once after creating it: `docker compose -f infra/docker-compose.yml run --rm --entrypoint sh infra -c "chmod 0640 /keys/depi-ecommerce"`. Jenkins must run on the machine whose public IP may SSH to the server (Terraform allows only that IP). On Linux, set `DOCKER_SOCKET_GID` in `jenkins/.env` to the group id of `/var/run/docker.sock`.

### 17.2 Deploying to AWS (Terraform + Ansible)

The first cloud deployment runs the whole stack with Docker Compose on one EC2 server. Terraform creates the infrastructure, Ansible configures the server and deploys a tested image version from Docker Hub.

```text
terraform/  ->  VPC, public subnet, internet gateway, security group (HTTP for everyone,
                SSH only from your IP), key pair, Ubuntu 24.04 EC2 (t3.small), Elastic IP,
                and ansible/inventory/hosts.ini with the server's IP
ansible/    ->  site.yml     install Docker (+ log rotation, swap) and deploy
                deploy.yml   deploy another version; automatic rollback if it fails
                rollback.yml go back to the previous version
```

All three tools run in a toolbox container (`infra/`), so nothing has to be installed on Windows (Ansible does not run on Windows). Every command below is run from the repository root.

**One-time preparation**

1. In the AWS console: create an IAM user for deployments with the `AmazonEC2FullAccess` policy and an access key (do not use the root account). Also create a monthly cost budget with an e-mail alert (Billing → Budgets).
2. Build the toolbox and store the access key in your local AWS profile (`~/.aws`, never in the repository):

   ```bash
   docker compose -f infra/docker-compose.yml build
   docker compose -f infra/docker-compose.yml run --rm infra aws configure --profile depi
   docker compose -f infra/docker-compose.yml run --rm infra aws sts get-caller-identity
   ```

3. Create the SSH key pair that Terraform installs on the server and Ansible uses:

   ```bash
   docker compose -f infra/docker-compose.yml run --rm infra ssh-keygen -t ed25519 -N "" -C depi-ecommerce -f /keys/depi-ecommerce
   ```

**Create the server and deploy**

```bash
docker compose -f infra/docker-compose.yml run --rm infra terraform -chdir=terraform init
docker compose -f infra/docker-compose.yml run --rm infra terraform -chdir=terraform plan -out=tfplan
docker compose -f infra/docker-compose.yml run --rm infra terraform -chdir=terraform apply tfplan
docker compose -f infra/docker-compose.yml run --rm -w /work/ansible infra ansible-playbook site.yml -e image_tag=<commit>
```

Use a commit tag that Jenkins published (for example `80cb67d`). The playbook prints the storefront URL. Secrets (database password, JWT secret, admin password) are generated on the server on the first deploy and never leave it; read the admin password with `sudo grep ADMIN_PASSWORD /opt/ecommerce/secrets.env` on the server.

**Deploy a new version and roll back**

```bash
docker compose -f infra/docker-compose.yml run --rm -w /work/ansible infra ansible-playbook deploy.yml -e image_tag=<new-commit>
docker compose -f infra/docker-compose.yml run --rm -w /work/ansible infra ansible-playbook rollback.yml
```

`deploy.yml` waits for every container health check and then calls every public API through Nginx. If the new version fails, it automatically redeploys the version that was running before and reports the failure. The history is kept on the server in `/opt/ecommerce/releases.log`.

**Cost control**

The server costs money while it exists (t3.small, 20 GB disk and public IP: roughly 2 US cents per hour). CPU credits are set to `standard`, so there are no burst charges. Delete everything after a session and recreate it from code next time:

```bash
docker compose -f infra/docker-compose.yml run --rm infra terraform -chdir=terraform destroy
```

Terraform state (`terraform/terraform.tfstate`) is local and ignored by Git; for team use it should move to an S3 backend.

### 17.3 Kubernetes

The same images run on Kubernetes. The manifests are in [`kubernetes/`](kubernetes/) and use Kustomize (built into `kubectl`):

```text
kubernetes/base/                 shared definition (namespace "ecommerce")
  config.yaml                    ConfigMap with the non-secret settings
  postgres.yaml                  StatefulSet + 1 GiB persistent volume
  <service>.yaml                 Deployment + Service for each Node.js service
  frontend.yaml                  Nginx (2 replicas) + LoadBalancer Service
  hpa.yaml                       autoscalers for search, product and frontend
kubernetes/overlays/local/       Docker Desktop: image versions, Secret, port 8000
kubernetes/addons/metrics-server metrics-server for Docker Desktop (k3s has it built in)
kubernetes/generate-secrets.js   creates the overlay's secrets.env (ignored by Git)
```

What each workload gets:

- **Probes:** a startup probe gives migrations (and PostgreSQL's first initialisation) several minutes; the readiness probe decides when a pod receives traffic; the liveness probe restarts a pod that hangs. Probe timeouts are generous so a slow machine does not cause restart loops.
- **Zero-downtime rolling updates:** `maxSurge: 1`, `maxUnavailable: 0`, so a new pod must be ready before an old one stops; the last five versions are kept for rollback.
- **Autoscaling (HPA):** `search-service` and `product-service` scale from 1 to 4 pods and `frontend` from 2 to 4 when average CPU passes 60% of the requested CPU.
- **Resources and security:** CPU/memory requests and limits on every container; Node.js services run as a non-root user without extra Linux capabilities; an init container waits for PostgreSQL.
- **Secrets:** a Kustomize `secretGenerator` builds the `ecommerce-secrets` Secret from `secrets.env`; the services read them as environment variables, never from the repository.
- **Nginx in Kubernetes:** the frontend image renders its config from `frontend/nginx.conf.template`; in Kubernetes it uses the cluster DNS (`kube-dns`) and fully qualified service names, in Docker Compose the Docker DNS.

Run locally (Docker Desktop → Settings → Kubernetes → Enable). The stack needs several GB of memory; on a machine with 8 GB of RAM use the AWS server instead (see the roadmap below).

```bash
kubectl apply -k kubernetes/addons/metrics-server
node kubernetes/generate-secrets.js kubernetes/overlays/local
kubectl apply -k kubernetes/overlays/local
kubectl -n ecommerce get pods,hpa
# storefront: http://localhost:8000
```

Rolling update, history and rollback:

```bash
kubectl -n ecommerce set image deployment/search-service search-service=mosab2004/ecommerce-search-service:<new-commit>
kubectl -n ecommerce rollout status deployment/search-service
kubectl -n ecommerce rollout history deployment/search-service
kubectl -n ecommerce rollout undo deployment/search-service
```

Remove everything: `kubectl delete namespace ecommerce`.

#### Kubernetes on AWS with k3s

k3s is a lightweight, certified Kubernetes distribution (metrics-server included). Terraform and Ansible create and configure it on one EC2 server:

```bash
# terraform/terraform.tfvars:  deploy_mode = "k3s"   instance_type = "c7i-flex.large"  (4 GiB)
docker compose -f infra/docker-compose.yml run --rm infra terraform -chdir=terraform apply
docker compose -f infra/docker-compose.yml run --rm -w /work/ansible infra ansible-playbook k3s.yml -e image_tag=<commit>
kubectl --kubeconfig kubernetes/kubeconfig-aws.yaml -n ecommerce get pods,hpa
```

- `deploy_mode = "k3s"` opens the Kubernetes API (port 6443) to the admin IP only and writes the inventory group `[k3s]`.
- `ansible/k3s.yml` installs k3s (Traefik disabled; the frontend LoadBalancer Service listens on port 80), saves `kubernetes/kubeconfig-aws.yaml` (ignored by Git) for `kubectl` on the admin machine, copies `kubernetes/base`, generates the secrets on the server, applies an overlay with the requested image tag, waits for every rollout and checks every API through Nginx. If the new version fails, it re-applies the previous version automatically.
- Jenkins deploys to whichever server exists: inventory group `[app]` → `site.yml` (Docker Compose), `[k3s]` → `k3s.yml` (Kubernetes).

**Autoscaling under load** ([`kubernetes/loadtest/k6-load.yaml`](kubernetes/loadtest/k6-load.yaml), a k6 Job inside the cluster: 40 virtual users searching and listing products for 3 minutes):

```bash
kubectl --kubeconfig kubernetes/kubeconfig-aws.yaml -n ecommerce apply -f kubernetes/loadtest/k6-load.yaml
kubectl --kubeconfig kubernetes/kubeconfig-aws.yaml -n ecommerce get hpa -w
```

Measured on a `c7i-flex.large` (2 vCPU, 4 GiB): 144,542 requests (628 per second), 0% failed, average latency 6.4 ms, p95 18.7 ms. The autoscalers raised `search-service` and `product-service` from 1 to 4 pods and `frontend` from 2 to 4 (CPU up to 215% of the request), and scaled back to 1/1/2 within minutes after the test.

**Rolling update and rollback without downtime:** `search-service` was updated from `894a6de` to `cf32e8d` with `kubectl set image` and returned with `kubectl rollout undo` while a client called the search API every 250 ms: 172 of 172 requests succeeded. `rollout undo` is the emergency path; the normal path is redeploying a tag with Ansible/Jenkins so the cluster always matches the manifests.

### 17.4 Deployment Roadmap

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

## 18. Security Considerations

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

## 19. Expected Outcomes

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

## 20. Conclusion

The Automated E-Commerce Deployment Platform demonstrates how DevOps tools and practices can automate the software delivery lifecycle, improve application reliability, simplify infrastructure management, and support scalable deployments for modern e-commerce systems. The eight-service e-commerce application provides the application foundation, while the planned DevOps phases extend it into an automated deployment and operations platform.
