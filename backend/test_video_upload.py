from pathlib import Path

from fastapi.testclient import TestClient

from main import app


def test_upload_video_is_saved_to_memory(tmp_path):
    client = TestClient(app)
    video_path = tmp_path / 'forest_road.mp4'
    video_path.write_bytes(b'fake-video-data')

    with video_path.open('rb') as fh:
        response = client.post(
            '/maps/upload-video',
            files={'file': ('forest_road.mp4', fh, 'video/mp4')},
            data={'name': 'Forest Road Memory'}
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['status'] == 'uploaded'
    assert payload['name'] == 'Forest Road Memory'
    assert payload['source_type'] == 'video'
    assert payload['file_path'].endswith('forest_road.mp4')
