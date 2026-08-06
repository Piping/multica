package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPAAssetHandlerServesIndexForInternalDocumentNavigation(t *testing.T) {
	t.Parallel()

	handler := newSPAAssetHandler(testAssets(t))
	request := httptest.NewRequest(http.MethodGet, "/local-traex/issues/LOCAL-1", nil)
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Sec-Fetch-Dest", "document")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if body := response.Body.String(); !strings.Contains(body, `id="root"`) {
		t.Fatalf("expected SPA entry, got %q", body)
	}
}

func TestSPAAssetHandlerLeavesStaticAssetsAndAPILikeRequestsAlone(t *testing.T) {
	t.Parallel()

	handler := newSPAAssetHandler(testAssets(t))

	assetRequest := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	assetResponse := httptest.NewRecorder()
	handler.ServeHTTP(assetResponse, assetRequest)
	if assetResponse.Code != http.StatusOK || assetResponse.Body.String() != "console.log('app')" {
		t.Fatalf("unexpected asset response: %d %q", assetResponse.Code, assetResponse.Body.String())
	}

	dataRequest := httptest.NewRequest(http.MethodGet, "/local-traex/issues/LOCAL-1", nil)
	dataRequest.Header.Set("Accept", "application/json")
	dataResponse := httptest.NewRecorder()
	handler.ServeHTTP(dataResponse, dataRequest)
	if dataResponse.Code != http.StatusNotFound {
		t.Fatalf("data request status = %d, want %d", dataResponse.Code, http.StatusNotFound)
	}
}

func testAssets(t *testing.T) fs.FS {
	t.Helper()
	return fstest.MapFS{
		"index.html": {
			Data: []byte(`<!doctype html><div id="root"></div>`),
		},
		"assets/app.js": {
			Data: []byte(`console.log('app')`),
		},
	}
}
