# Security Policy

## Supported Versions

We take security seriously and are committed to maintaining the security of ManuMarket. The following versions are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |

We recommend always using the latest version of the application to ensure you have the most recent security patches and updates.

## Reporting a Vulnerability

If you discover a security vulnerability in ManuMarket, please help us by reporting it responsibly. We appreciate your efforts to disclose your findings in a coordinated manner.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities by:

1. **Email**: Send details to the repository maintainers through GitHub's private vulnerability reporting feature, or contact the project maintainers directly.
2. **GitHub Security Advisories**: Use the "Security" tab in this repository to privately report a vulnerability.

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested fixes or mitigations (if available)
- Your contact information for follow-up questions

### Response Timeline

- **Initial Response**: We aim to acknowledge receipt of your vulnerability report within 48 hours.
- **Status Updates**: We will provide regular updates on our progress in addressing the vulnerability.
- **Resolution**: We will work to address confirmed vulnerabilities as quickly as possible, with critical issues being prioritized.

## Security Best Practices

### For Developers

When working with ManuMarket, please follow these security guidelines:

1. **Authentication & Authorization**
   - Never commit credentials, API keys, or secrets to the repository
   - Use environment variables for sensitive configuration
   - Implement proper JWT token management and validation
   - Follow the principle of least privilege for user permissions

2. **Dependencies**
   - Keep all dependencies up to date
   - Regularly run `pip list --outdated` to check for updates
   - Review security advisories for Django and other dependencies
   - Use Dependabot alerts to stay informed about vulnerabilities

3. **Database Security**
   - Use parameterized queries (Django ORM does this by default)
   - Never expose database credentials in code or logs
   - Use strong passwords for database users
   - Limit database access to necessary services only

4. **API Security**
   - Validate and sanitize all user inputs
   - Implement rate limiting to prevent abuse
   - Use HTTPS in production environments
   - Configure CORS properly (django-cors-headers)
   - Enable CSRF protection for state-changing operations

5. **Docker & Container Security**
   - Don't run containers as root user when possible
   - Keep base images updated
   - Scan images for vulnerabilities regularly
   - Don't include sensitive data in Docker images

### For Deployment

1. **Change Default Credentials**
   - **IMPORTANT**: The default credentials (`admin/admin123` and `trabajador/worker123`) shown in README.md are for **development only**
   - Always change default passwords before deploying to production
   - Use strong, unique passwords for all accounts

2. **Environment Configuration**
   - Set `DEBUG = False` in production
   - Use a strong `SECRET_KEY` and keep it secret
   - Configure `ALLOWED_HOSTS` appropriately
   - Enable security middleware (SecurityMiddleware, etc.)

3. **Network Security**
   - Use HTTPS/TLS for all connections
   - Configure firewalls to restrict access
   - Use secure communication between services
   - Implement proper CORS policies

4. **Monitoring & Logging**
   - Enable security logging
   - Monitor for suspicious activities
   - Set up alerts for security events
   - Regularly review access logs

## Known Security Considerations

### Development vs Production

This repository contains development configuration that should **NOT** be used in production:

- Default credentials in README.md and batch files
- Debug mode may be enabled
- Development server settings
- Sample data and test configurations

### Dependencies

The project uses several key dependencies that should be kept updated:

- Django 5.2.7
- Django REST Framework
- djangorestframework-simplejwt (for JWT authentication)
- django-cors-headers
- psycopg2-binary

Regular updates to these packages are essential for maintaining security.

## Security Update Policy

- Security patches will be released as soon as possible after a vulnerability is confirmed
- Users will be notified of security updates through GitHub releases and security advisories
- Critical vulnerabilities will be addressed with highest priority
- We encourage all users to subscribe to repository notifications for security updates

## Disclosure Policy

- We follow responsible disclosure practices
- Security researchers will be credited for their findings (unless they prefer to remain anonymous)
- We will coordinate disclosure timing with reporters
- Public disclosure will occur after a fix is available and users have had time to update

## Additional Resources

- [Django Security Documentation](https://docs.djangoproject.com/en/stable/topics/security/)
- [OWASP Top Ten](https://owasp.org/www-project-top-ten/)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)

## Questions?

If you have questions about security that are not covered in this policy, please reach out to the repository maintainers through GitHub.

---

**Last Updated**: October 2025
