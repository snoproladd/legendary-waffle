
-- 1. Drop unique constraints if they exist
IF EXISTS (
    SELECT 1 FROM sys.objects
    WHERE type = 'UQ' AND name = 'UQ__voluntee__AB6E61641C4CA267'
)
BEGIN
    ALTER TABLE [dbo].[volunteer_in] DROP CONSTRAINT [UQ__voluntee__AB6E61641C4CA267];
END
GO

IF EXISTS (
    SELECT 1 FROM sys.objects
    WHERE type = 'UQ' AND name = 'UQ_volunteer_phone'
)
BEGIN
    ALTER TABLE [dbo].[volunteer_in] DROP CONSTRAINT [UQ_volunteer_phone];
END
GO

-- 2. Truncate the table (removes all rows and resets identity)
TRUNCATE TABLE [dbo].[volunteer_in];
GO

-- 3. Recreate unique constraints
ALTER TABLE [dbo].[volunteer_in]
ADD CONSTRAINT [UQ__voluntee__AB6E61641C4CA267] UNIQUE ([email]);  -- Assuming this was on email
GO

ALTER TABLE [dbo].[volunteer_in]
ADD CONSTRAINT [UQ_volunteer_phone] UNIQUE ([phone]);  -- Assuming this was on phone
