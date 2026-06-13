# Security policy

Report security issues privately to the production operator's monitored security contact. Do not
include credentials or personal data in public issues.

Production credentials must live only in the deployment platform secret store. Rotate credentials
after suspected exposure, use the least-privileged database role for the application, and reserve
the Neon owner credential for migration and recovery workflows.
