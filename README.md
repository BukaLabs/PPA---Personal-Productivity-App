# Focus Dashboard

A Streamlit version of the personal productivity dashboard.

## Run locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Deploy on Streamlit Community Cloud

1. Push this folder to a GitHub repository.
2. Create a new app in Streamlit Community Cloud.
3. Set the main file path to `app.py`.
4. Deploy.

The app stores its working state in `.streamlit_data/focus_dashboard_state.json` while the Streamlit app is running. Use **Export CSV** to keep a portable copy of your daily history.
