// CI pipeline for the e-commerce platform (see README "CI/CD with Jenkins").
//
// Every branch:  unit tests -> build images -> end-to-end test on a throwaway stack
// main only:     push the tested images to Docker Hub as <short commit> and latest,
//                then deploy them to the AWS server (when one exists) with Ansible
//
// A failing stage stops the pipeline, so untested images are never published or deployed.
// A deploy that fails its health checks is rolled back to the previous version by Ansible.
pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    // Separate Compose project, port and volume, so the test stack never touches a
    // developer's stack on the same Docker engine.
    COMPOSE_PROJECT_NAME = 'ecommerce-ci'
    FRONTEND_PORT = '3080'
    E2E_BASE_URL = 'http://host.docker.internal:3080'
    // Build two images at a time to keep memory use low on small machines.
    COMPOSE_PARALLEL_LIMIT = '2'
    COMPOSE = 'docker compose --env-file ci.env'
    // Written by "terraform apply" and removed by "terraform destroy" (mounted read-only).
    DEPLOY_INVENTORY = '/deploy-inventory/hosts.ini'
  }

  stages {
    stage('Prepare') {
      steps {
        script {
          env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          currentBuild.description = "images: ${env.DOCKERHUB_USER}/ecommerce-*:${env.IMAGE_TAG}"
        }
        sh 'node tests/write-ci-env.js > ci.env'
        sh 'node --version && docker version --format "Docker {{.Server.Version}}" && docker compose version'
      }
    }

    stage('Unit tests') {
      steps {
        sh 'npm run test:unit'
      }
    }

    stage('Build images') {
      steps {
        sh '$COMPOSE build'
        sh '$COMPOSE config --images'
      }
    }

    stage('End-to-end test') {
      steps {
        sh '$COMPOSE down -v --remove-orphans || true'
        sh '$COMPOSE up -d --no-build --wait --wait-timeout 300'
        sh 'set -a && . ./ci.env && set +a && npm run test:e2e'
      }
      post {
        // Declarative "post" runs always -> ... -> failure -> ... -> cleanup, so the stack is
        // removed in "cleanup"; otherwise it would be gone before the failure logs are printed.
        failure {
          sh '$COMPOSE ps -a || true'
          sh '$COMPOSE logs --no-color --timestamps --tail=120 || true'
        }
        cleanup {
          sh '$COMPOSE down -v --remove-orphans || true'
        }
      }
    }

    stage('Push to Docker Hub') {
      when {
        branch 'main'
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'HUB_USER', passwordVariable: 'HUB_TOKEN')]) {
          // A throwaway Docker config keeps the login out of the Jenkins home directory.
          sh '''
            set -eu
            export DOCKER_CONFIG="$(mktemp -d)"
            trap 'rm -rf "$DOCKER_CONFIG"' EXIT
            echo "$HUB_TOKEN" | docker login --username "$HUB_USER" --password-stdin
            $COMPOSE push
            for image in $($COMPOSE config --images | grep "^$DOCKERHUB_USER/"); do
              docker tag "$image" "${image%:*}:latest"
              docker push "${image%:*}:latest"
            done
          '''
        }
      }
    }

    stage('Deploy to AWS') {
      when {
        allOf {
          branch 'main'
          // Only while a server exists; otherwise the stage is skipped, not failed.
          expression { sh(script: 'test -s "$DEPLOY_INVENTORY"', returnStatus: true) == 0 }
        }
      }
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: 'deploy-ssh', keyFileVariable: 'DEPLOY_KEY')]) {
          // site.yml is idempotent: it installs Docker on a new server and is quick on a
          // prepared one. Ansible rolls back automatically if the new version fails.
          sh '''
            set -eu
            cd ansible
            export ANSIBLE_SSH_ARGS="-o ControlMaster=auto -o ControlPersist=60s -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$WORKSPACE/.deploy_known_hosts"
            ansible-playbook site.yml -i "$DEPLOY_INVENTORY" --private-key "$DEPLOY_KEY" -e image_tag="$IMAGE_TAG"
          '''
        }
        // Check from outside, like a visitor (also proves the firewall allows HTTP).
        sh '''
          set -eu
          host=$(grep -o 'ansible_host=[0-9.]*' "$DEPLOY_INVENTORY" | cut -d= -f2)
          for path in / /api/search/health /api/order/health; do
            # A few short retries absorb a container that is still settling after a restart.
            code=000
            for attempt in 1 2 3 4 5; do
              code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$host$path" || true)
              [ "$code" = 200 ] && break
              sleep 5
            done
            echo "http://$host$path -> $code"
            test "$code" = 200
          done
        '''
        script {
          currentBuild.description = "deployed ${env.IMAGE_TAG} to AWS"
        }
      }
    }
  }

  post {
    success {
      echo "Tested images: ${env.DOCKERHUB_USER}/ecommerce-*:${env.IMAGE_TAG}"
    }
    always {
      cleanWs()
    }
  }
}
