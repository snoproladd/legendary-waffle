
# -------------------------------
# CONFIGURATION
# -------------------------------
$resourceGroup = "DefaultResourceGroup-EUS"
$appName = "AlbanyJWParking"
$outputFile = "C:\Git Repos\legendary-waffle\.env"  # Change path as needed

# -------------------------------
# Ensure Az module is installed
# -------------------------------
if (-not (Get-Module -ListAvailable -Name Az.Accounts)) {
    Write-Host "Installing Az module..."
    Install-Module -Name Az -Scope CurrentUser -Repository PSGallery -Force
}

# Import required modules
Import-Module Az.Accounts
Import-Module Az.Websites

# -------------------------------
# Connect to Azure
# -------------------------------
Write-Host "Logging into Azure..."
Connect-AzAccount

# -------------------------------
# Get App Settings
# -------------------------------
Write-Host "Fetching App Settings for $appName..."
$appSettings = (Get-AzWebApp -ResourceGroupName $resourceGroup -Name $appName).SiteConfig.AppSettings

# -------------------------------
# Filter and Export to .env
# -------------------------------
Write-Host "Exporting settings to $outputFile..."
$envContent = ""

foreach ($setting in $appSettings) {
    # Optional: Filter only SQL-related settings
    if ($setting.Name -match "SQL|DOCKER|WEBSITES") {
        $envContent += "$($setting.Name)=$($setting.Value)`r`n"
    }
}

## Write to file
$envContent | Out-File -FilePath $outputFile -Encoding UTF8

