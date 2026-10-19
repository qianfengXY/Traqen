-- Operator-authorized retirement of authenticator codes and one-time MFA recovery.
-- Preserve passwords and explicit administrator grants, including pending grants.
UPDATE auth_record
SET payload = (payload - 'totp' - 'adminRequested') || jsonb_build_object(
  'admin', COALESCE((payload->>'admin')::boolean, false)
           OR COALESCE((payload->>'adminRequested')::boolean, false)
)
WHERE kind='accounts' AND (payload ? 'totp' OR payload ? 'adminRequested');

-- Never turn an incomplete old login into a fully authenticated session.
UPDATE auth_record
SET payload = (payload - 'enrollment') ||
  CASE WHEN payload->>'phase' IN ('MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED')
       THEN '{"revoked":true}'::jsonb ELSE '{}'::jsonb END
WHERE kind='sessions' AND (payload ? 'enrollment'
  OR payload->>'phase' IN ('MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED'));
