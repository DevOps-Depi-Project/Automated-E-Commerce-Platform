// CI pipeline for the e-commerce platform (see README "CI/CD with Jenkins").
//
// Every branch:  unit tests -> build images -> end-to-end test on a throwaway stack
// main only:     push the tested images to Docker Hub as <short commit> and latest
//
// A failing stage stops the pipeline, so untested images are never published.
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
        failure {
          sh '$COMPOSE ps -a || true'
          sh '$COMPOSE logs --no-color --tail=80 || true'
        }
        always {
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
