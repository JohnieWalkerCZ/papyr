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
                self.assertEqual(api['ConnectionStrings__Papyr'], 'Host=db;Database=papyr;Username=papyr')


if __name__ == '__main__':
    unittest.main()
