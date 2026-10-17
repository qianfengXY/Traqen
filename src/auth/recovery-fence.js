// Appended to the imported archive's single transaction. Older archives may
// predate F008; create only the closed control boundary before migrations run.
export const authenticationRestoreFenceSql = `
CREATE TABLE IF NOT EXISTS public.auth_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 initialized boolean NOT NULL DEFAULT false,
 recovery boolean NOT NULL DEFAULT false,
 epoch bigint NOT NULL DEFAULT 1,
 revision bigint NOT NULL DEFAULT 0
);
INSERT INTO public.auth_control(singleton,initialized,recovery) VALUES(true,true,true)
 ON CONFLICT(singleton) DO UPDATE SET initialized=true,recovery=true,epoch=auth_control.epoch+1;
DO $f008_restore$
BEGIN
 IF to_regclass('public.auth_record') IS NOT NULL THEN
  UPDATE public.auth_record SET payload=jsonb_set(payload,'{used}','true') WHERE kind='credentials';
  UPDATE public.auth_record SET payload=payload-'recoveryAdmin' WHERE kind='accounts';
 END IF;
END
$f008_restore$;
`;
