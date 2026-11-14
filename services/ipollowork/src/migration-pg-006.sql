-- Independent calls from the same account may run together; request IDs remain unique.
DROP INDEX IF EXISTS service_calls_one_running;
