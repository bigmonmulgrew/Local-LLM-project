# This is an example file only
from L3M_Web.app_factory import create_app
from L3M_Web.config.settings import Settings

settings = Settings(
    app_name="Test Application",
    # Test-specific values...
)

app = create_app(settings)