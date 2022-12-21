package rpcz

import (
	"log"
	"os"
	"testing"

	"comms.audius.co/db"
)

// this runs before all tests (not a per-test setup / teardown)
func TestMain(m *testing.M) {
	// setup
	os.Setenv("audius_db_url", "postgresql://postgres:postgres@localhost:5454/comtest?sslmode=disable")
	err := db.Dial()
	if err != nil {
		log.Fatal(err)
	}

	// run tests
	code := m.Run()

	// teardown code here...
	os.Exit(code)
}
