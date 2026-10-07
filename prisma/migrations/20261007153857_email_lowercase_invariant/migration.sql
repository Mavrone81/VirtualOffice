-- Stored emails must already be lowercase (2026-10-07).
--
-- Login looks a user up with `email.toLowerCase().trim()`, but the write paths
-- stored whatever was typed, and PostgreSQL compares text case-sensitively. An
-- address saved as "Louisewsf@gmail.com" therefore could never be found by a
-- login attempt. The failure gives no clue: the account is active, the password
-- is correct, an admin can reset it successfully, and the person still cannot
-- get in. This had silently locked out 5 of 25 users before anyone reported it.
--
-- The application now normalises on every write. This constraint is here
-- because "every write" is a claim about code that keeps changing, and the cost
-- of one missed path is a user who cannot log in and no error anywhere. A
-- violating write now fails loudly at the point it happens instead.
--
-- The existing rows were normalised before this ran; the constraint would
-- refuse to be added otherwise, which is itself the check that they were.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_is_lowercase" CHECK (email = lower(email));

-- Associates may have no email at all, so NULL has to pass.
ALTER TABLE "associates"
  ADD CONSTRAINT "associates_email_is_lowercase" CHECK (email IS NULL OR email = lower(email));
