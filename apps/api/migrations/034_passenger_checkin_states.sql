ALTER TABLE passenger_checkins DROP CONSTRAINT passenger_checkins_state_check;
ALTER TABLE passenger_checkins ADD CONSTRAINT passenger_checkins_state_check CHECK(state IN ('arrived','balance_pending','waiver_pending','cleared_to_board','boarded','no_show'));
