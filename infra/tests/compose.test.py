import json
import os
from pathlib import Path
import subprocess
import unittest


class ComposePasswordTests(unittest.TestCase):
    def test_database_password_is_passed_as_data(self):
        root = Path(__file__).resolve().parents[2]
        for password in ['simple-password', 'semi;colon', '"quoted";Host=other', "space ' dollar$ backslash\\"]:
            with self.subTest(password=password):
                result = subprocess.run(
                    ['docker', 'compose', '-f', str(root / 'infra/compose.yaml'), 'config', '--format', 'json'],
                    env={**os.environ, 'PAPYR_DB_PASSWORD': password},
                    check=True, capture_output=True, text=True,
                )
                services = json.loads(result.stdout)['services']
                api = services['api']['environment']
                # Compose config escapes dollars for reuse as a Compose file.
                self.assertEqual(api['PGPASSWORD'].replace('$$', '$'), password)
                self.assertEqual(services['db']['environment']['POSTGRES_PASSWORD'].replace('$$', '$'), password)
                self.assertEqual(services['db-password-reset']['environment']['POSTGRES_PASSWORD'].replace('$$', '$'), password)
                self.assertEqual(api['ConnectionStrings__Papyr'], 'Host=db;Database=papyr;Username=papyr')

    def test_password_reset_requires_explicit_opt_in_and_blocks_api_until_completed(self):
        root = Path(__file__).resolve().parents[2]
        for enabled in ['false', 'true']:
            with self.subTest(enabled=enabled):
                result = subprocess.run(
                    ['docker', 'compose', '-f', str(root / 'infra/compose.yaml'), 'config', '--format', 'json'],
                    env={**os.environ, 'PAPYR_RESET_DB_PASSWORD': enabled},
                    check=True, capture_output=True, text=True,
                )
                services = json.loads(result.stdout)['services']
                reset = services['db-password-reset']
                self.assertEqual(reset['environment']['PAPYR_RESET_DB_PASSWORD'], enabled)
                self.assertEqual(reset['network_mode'], 'none')
                self.assertEqual(services['api']['depends_on']['db-password-reset']['condition'], 'service_completed_successfully')
                self.assertNotIn('papyr-postgres', str(reset['volumes']))


    def test_administrator_credentials_reach_only_the_api(self):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            ['docker', 'compose', '-f', str(root / 'infra/compose.yaml'), 'config', '--format', 'json'],
            env={**os.environ, 'PAPYR_ADMIN_USERNAME': 'recovered-admin', 'PAPYR_ADMIN_PASSWORD': 'private;recovery$password'},
            check=True, capture_output=True, text=True,
        )
        services = json.loads(result.stdout)['services']
        self.assertEqual(services['api']['environment']['PAPYR_ADMIN_USERNAME'], 'recovered-admin')
        self.assertEqual(services['api']['environment']['PAPYR_ADMIN_PASSWORD'].replace('$$', '$'), 'private;recovery$password')
        for name in ['web', 'db', 'db-password-reset']:
            self.assertNotIn('PAPYR_ADMIN_PASSWORD', services[name].get('environment', {}))


if __name__ == '__main__':
    unittest.main()
