-- Executive-ordained sector display order (owner directive): Solutions first, then Consulting,
-- then Strategic Projects, then SAP. Everything that lists sectors orders by sort_order.
UPDATE sector SET sort_order = 1 WHERE id = 'SOLUTIONS';
UPDATE sector SET sort_order = 2 WHERE id = 'CONSULTING';
UPDATE sector SET sort_order = 3 WHERE id = 'STRATEGIC';
UPDATE sector SET sort_order = 4 WHERE id = 'SAP';
