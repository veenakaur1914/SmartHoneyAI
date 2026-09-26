#!/bin/sh
set -eu

apk add --no-cache bash curl subversion mariadb-client >/dev/null
curl --fail --location --silent --show-error https://getcomposer.org/download/2.8.10/composer.phar --output /tmp/composer.phar
cp -a /src /tmp/plugin
cd /tmp/plugin
/usr/local/bin/php /tmp/composer.phar install --no-interaction --prefer-dist --no-progress
vendor/bin/phpcs
db_password="$(cat /run/secrets/wordpress_db_root_password)"
bash /work/install-wordpress-tests.sh wordpress_test root "$db_password" wordpress-db:3306 "${WP_TEST_VERSION:-6.8.2}"
vendor/bin/phpunit
