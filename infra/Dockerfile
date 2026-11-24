# Infrastructure toolbox: Terraform, AWS CLI v2 and Ansible in one Linux container,
# so nobody has to install them (Ansible does not run natively on Windows).
# Used through infra/docker-compose.yml, for example:
#   docker compose -f infra/docker-compose.yml run --rm infra terraform -chdir=terraform plan
FROM python:3.12-slim-bookworm

ARG ANSIBLE_CORE_VERSION=2.17.*

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip openssh-client git less jq \
 # Terraform from HashiCorp's apt repository
 && curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com $(. /etc/os-release && echo "$VERSION_CODENAME") main" \
      > /etc/apt/sources.list.d/hashicorp.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends terraform \
 # AWS CLI v2 (official installer)
 && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install \
 && rm -rf /tmp/aws /tmp/awscliv2.zip /var/lib/apt/lists/*

RUN pip install --no-cache-dir "ansible-core==${ANSIBLE_CORE_VERSION}"

COPY entrypoint.sh /usr/local/bin/infra-entrypoint
RUN chmod 0755 /usr/local/bin/infra-entrypoint \
 && terraform version && aws --version && ansible --version | head -1

ENTRYPOINT ["infra-entrypoint"]
CMD ["bash"]
